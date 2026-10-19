import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { dirname, join } from "path";
import { decide } from "./agent-browser-guard.ts";

const ROOT = "/private/tmp/claude-501";
const P = "mcp__agent-browser__agent_browser_";
const call = (tool: string, input: unknown) => ({
  hook_event_name: "PreToolUse",
  tool_name: `${P}${tool}`,
  tool_input: input,
});

let tmp: string | null = null;
beforeAll(() => {
  try {
    mkdirSync(ROOT, { recursive: true });
    tmp = mkdtempSync(join(ROOT, "abguard-test-"));
  } catch {
    tmp = null;
  }
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("allows", () => {
  test("open https URL", () => expect(decide(call("open", { url: "https://example.com/a?b=1" }))).toBeNull());
  test("open about:blank", () => expect(decide(call("open", { url: "about:blank" }))).toBeNull());
  test("snapshot compact", () => expect(decide(call("snapshot", { compact: true }))).toBeNull());
  test("screenshot without path", () => expect(decide(call("screenshot", {}))).toBeNull());
  test("a11y json", () => expect(decide(call("a11y", { json: true }))).toBeNull());
  test("vitals localhost", () => expect(decide(call("vitals", { url: "http://localhost:3000" }))).toBeNull());
  test("scroll direction is not a directory key", () =>
    expect(decide(call("scroll", { direction: "down", amount: 300 }))).toBeNull());
  test.each(["work", "my-session_2", "A1"])("session name %s", (session) =>
    expect(decide(call("snapshot", { session }))).toBeNull());
  test("screenshot path under the allowed root", () => {
    if (!tmp) return;
    expect(decide(call("screenshot", { path: join(tmp, "x", "a.png") }))).toBeNull();
  });
  test("screenshot path via /tmp spelling", () => {
    if (!tmp) return;
    expect(decide(call("screenshot", { path: join(tmp, "a.png").replace("/private", "") }))).toBeNull();
  });
});

describe("denies", () => {
  test.each(["extraArgs", "caCert", "restore", "namespace", "headed", "webmcp", "screenshotDir"])(
    "forbidden key %s",
    (key) => expect(decide(call("snapshot", { [key]: key === "extraArgs" ? [] : true }))).toContain("forbidden"),
  );
  test.each(["../x", "a/b", "/abs", "..", "a b", "a.b", "", "x\0", "a\\b"])("session %j", (session) =>
    expect(decide(call("snapshot", { session }))).toContain("session must match"));
  test("non-string session", () => expect(decide(call("snapshot", { session: 5 }))).toContain("session must match"));
  test("restore true",() => expect(decide(call("open", { restore: true }))).not.toBeNull());
  for (const key of ["outputDir", "userDataDir", "executablePath", "profile", "downloadDirectory", "certFile"]) {
    test(`unvetted filesystem-like key ${key}`, () =>
      expect(decide(call("open", { [key]: "/x" }))).toContain("not vetted"));
  }
  test("inspect tool", () => expect(decide(call("inspect", {}))).toContain("not allowlisted"));
  test("path outside root", () =>
    expect(decide(call("screenshot", { path: "/Users/inouetsukasa/dotfiles/claude-code/settings.json" }))).not.toBeNull());
  test("path with .. segments", () =>
    expect(decide(call("screenshot", { path: `${ROOT}/../../etc/x` }))).toContain(".."));
  test("relative path", () => expect(decide(call("screenshot", { path: "a.png" }))).not.toBeNull());
  test("sibling prefix is not under root", () =>
    expect(decide(call("screenshot", { path: `${ROOT}-evil/a.png` }))).not.toBeNull());
  test("NUL in path", () => expect(decide(call("screenshot", { path: `${ROOT}/a\0.png` }))).not.toBeNull());
  test("empty path", () => expect(decide(call("screenshot", { path: "" }))).not.toBeNull());
  test("non-string output", () => expect(decide(call("screenshot", { output: 5 }))).not.toBeNull());
  test("baseline outside root", () => expect(decide(call("diff_screenshot", { baseline: "/etc/passwd" }))).not.toBeNull());
  test("symlink escape", () => {
    if (!tmp) return;
    symlinkSync("/Users", join(tmp, "link"));
    expect(decide(call("screenshot", { path: join(tmp, "link", "new", "a.png") }))).toContain("symlink");
  });
  test("file: URL", () => expect(decide(call("open", { url: "file:///etc/passwd" }))).not.toBeNull());
  test("javascript: URL", () => expect(decide(call("open", { url: "javascript:alert(1)" }))).not.toBeNull());
  test("data: URL", () => expect(decide(call("open", { url: "data:text/html,hi" }))).not.toBeNull());
  test("unparseable URL", () => expect(decide(call("open", { url: "not a url" }))).not.toBeNull());
  test("non-string URL", () => expect(decide(call("diff_url", { url1: 1, url2: "about:blank" }))).not.toBeNull());
  test("file: in other string field", () =>
    expect(decide(call("click", { selector: "  FILE:///etc/passwd" }))).toContain("file:"));
  test("file: nested in array", () => expect(decide(call("click", { x: ["file:///a"] }))).not.toBeNull());
  test.each(["upload", "download", "pdf", "batch", "connect", "plugin_run", "install", "clipboard_read", "set_viewport", "chat", "future_tool"])(
    "tool %s",
    (tool) => expect(decide(call(tool, {}))).toContain("not allowlisted"),
  );
  test("other MCP server", () =>
    expect(decide({ tool_name: "mcp__playwright__browser_click", tool_input: {} })).not.toBeNull());
  test("prefix only", () => expect(decide(call("", {}))).not.toBeNull());
  test("tool_input array", () => expect(decide(call("snapshot", []))).not.toBeNull());
  test("tool_input null", () => expect(decide(call("snapshot", null))).not.toBeNull());
  test("tool_input missing", () => expect(decide({ tool_name: `${P}snapshot` })).not.toBeNull());
  test("payload not an object", () => {
    for (const p of [null, "str", 5, [], undefined]) expect(decide(p)).not.toBeNull();
  });
});

describe("main", () => {
  const run = async (stdin: string) => {
    const proc = Bun.spawn(["bun", join(dirname(import.meta.path), "agent-browser-guard.ts")], {
      stdin: new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { out, code };
  };

  test("malformed stdin is denied", async () => {
    const { out, code } = await run("{not json");
    expect(code).toBe(0);
    const j = JSON.parse(out);
    expect(j.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(j.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("empty stdin is denied", async () => {
    const { out } = await run("");
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("allowed payload prints nothing", async () => {
    const { out, code } = await run(JSON.stringify(call("snapshot", { compact: true })));
    expect(out).toBe("");
    expect(code).toBe(0);
  });

  test("denied payload prints deny JSON", async () => {
    const { out, code } = await run(JSON.stringify(call("upload", {})));
    expect(code).toBe(0);
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
