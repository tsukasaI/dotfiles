import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "claude-code/hooks/block-config-edit.sh");

type Outcome = { code: number | null; stderr: string };

function runRaw(stdin: string): Outcome {
  const r = spawnSync("bash", [HOOK], { input: stdin, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
}

function run(tool: "Edit" | "Write", filePath: unknown): Outcome {
  return runRaw(JSON.stringify({ tool_name: tool, tool_input: { file_path: filePath } }));
}

function expectBlocked(out: Outcome, tag: string): void {
  expect(out.code).toBe(2);
  expect(out.stderr).toContain(`[BLOCKED: ${tag}]`);
}

describe("fail closed on unusable input", () => {
  test.each([
    ["empty stdin", ""],
    ["non-JSON", "not json"],
  ])("%s", (_name, stdin) => {
    expectBlocked(runRaw(stdin), "INTERNAL_ERROR");
  });
});

describe("file_path type", () => {
  test.each([
    ["tool_input without file_path", JSON.stringify({ tool_name: "Edit", tool_input: {} }), 0],
    ["file_path null", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: null } }), 0],
    ["file_path empty string", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "" } }), 0],
  ])("%s is allowed", (_name, stdin, code) => {
    expect(runRaw(stdin).code).toBe(code);
  });

  test("a non-string file_path is blocked", () => {
    expectBlocked(run("Edit", 123), "INTERNAL_ERROR");
  });
});

describe("path form", () => {
  test.each([
    ["relative", "src/a.ts"],
    ["dot-relative", "./a.ts"],
    ["double slash", "/x//a.ts"],
    ["dot segment", "/x/./a.ts"],
    ["dotdot segment", "/x/../a.ts"],
    ["trailing dotdot", "/x/proj/.."],
  ])("%s", (_name, path) => {
    expectBlocked(run("Edit", path), "PATH_FORM");
  });
});

describe("matching is case-insensitive", () => {
  test.each([
    ["/x/proj/.GITLEAKS.TOML", "SECRET_SCAN_PROTECTION"],
    ["/x/CLAUDE-CODE/HOOKS/x.ts", "GUARDRAIL_PROTECTION"],
    ["/x/proj/PACKAGE-LOCK.JSON", "LOCKFILE_PROTECTION"],
  ])("%s", (path, tag) => {
    expectBlocked(run("Edit", path), tag);
  });
});

describe("guardrail files", () => {
  test.each([
    "/anyprefix/claude-code/hooks/x.ts",
    "/x/claude-code/lib/a.ts",
    "/x/claude-code/settings.json",
    "/x/claude-code/shguard/config.toml",
    "/x/proj/lefthook.yml",
    "/x/proj/.lefthook-local.yml",
  ])("%s", (path) => {
    expectBlocked(run("Edit", path), "GUARDRAIL_PROTECTION");
  });
});

describe("secret-scan config", () => {
  test.each(["/x/proj/.gitleaks.toml", "/x/proj/.gitleaksignore", "/x/claude-code/gitleaks/a.toml"])("%s", (path) => {
    expectBlocked(run("Write", path), "SECRET_SCAN_PROTECTION");
  });
});

describe("lockfiles", () => {
  test.each(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock", "go.sum"])(
    "%s",
    (name) => {
      expectBlocked(run("Edit", `/x/proj/sub/${name}`), "LOCKFILE_PROTECTION");
    },
  );
});

describe("symlinks", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "block-config-edit-"));
    mkdirSync(join(root, "real/claude-code/hooks"), { recursive: true });
    mkdirSync(join(root, "real/src"), { recursive: true });
    symlinkSync(join(root, "real/claude-code/hooks"), join(root, "link"));
    symlinkSync(join(root, "real/src"), join(root, "safe-link"));
    symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a new file under a symlink to a protected dir is blocked by its resolved target", () => {
    expectBlocked(run("Write", join(root, "link/new.ts")), "GUARDRAIL_PROTECTION");
  });

  test("a new file under a symlink to an unprotected dir is allowed", () => {
    expect(run("Write", join(root, "safe-link/a.ts")).code).toBe(0);
  });

  test("a dangling symlink is blocked", () => {
    expectBlocked(run("Write", join(root, "dangling")), "SYMLINK");
  });
});

describe("ordinary files", () => {
  test.each(["Edit", "Write"] as const)("%s allows ordinary project files", (tool) => {
    for (const path of ["/x/proj/src/a.ts", "/x/proj/.eslintrc.json", "/x/proj/README.md"]) {
      expect(run(tool, path).code).toBe(0);
    }
  });
});
