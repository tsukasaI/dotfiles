// Offline tests for pi/extensions/format.ts. Run: bun test pi/tests
// The last test runs the real fini binary when it is on PATH.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import format, { formatFile } from "../extensions/format.ts";

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-fmt-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("formatFile", () => {
	test("silent when fini changes nothing and finds nothing", async () => {
		const f = join(dir, "clean.ts");
		writeFileSync(f, "a\n");
		expect(await formatFile(f, async () => ({ stdout: "" }))).toBeUndefined();
	});
	test("says so when the file was rewritten, and passes findings through", async () => {
		const f = join(dir, "dirty.ts");
		writeFileSync(f, "a  \n");
		const note = await formatFile(f, async (p) => {
			writeFileSync(p, "a\n");
			return { stdout: "Detected: dirty.ts\n  - TODO comment at line 1\n" };
		});
		expect(note).toContain("re-read it");
		expect(note).toContain("TODO comment");
	});
	test("a failed run is reported, a missing file is skipped", async () => {
		const f = join(dir, "x.ts");
		writeFileSync(f, "x\n");
		expect(await formatFile(f, async () => ({ stdout: "", error: new Error("spawn fini ENOENT") }))).toContain("did not run");
		expect(await formatFile(join(dir, "missing.ts"), async () => ({ stdout: "" }))).toBeUndefined();
	});
});

describe("extension", () => {
	function handler(run = async (p: string) => (writeFileSync(p, "fixed\n"), { stdout: "" })) {
		let h: Function | undefined;
		format({ on: (_e: string, fn: Function) => (h = fn) } as any, run);
		return (event: object) => h!({ content: [{ type: "text", text: "ok" }], isError: false, ...event }, { cwd: dir });
	}
	test("only successful write/edit results are formatted", async () => {
		writeFileSync(join(dir, "e.ts"), "e  \n");
		expect(await handler()({ toolName: "read", input: { path: "e.ts" } })).toBeUndefined();
		expect(await handler()({ toolName: "edit", input: { path: "e.ts" }, isError: true })).toBeUndefined();
		const res = await handler()({ toolName: "edit", input: { path: "e.ts" } });
		expect(res.content[0].text).toBe("ok");
		expect(res.content[1].text).toContain("normalized");
	});
});

let hasFini = true;
try {
	execFileSync("fini", ["--version"]);
} catch {
	hasFini = false;
}
test.skipIf(!hasFini)("real fini strips trailing whitespace", async () => {
	const f = join(dir, "real.ts");
	writeFileSync(f, "a  \nb\n");
	expect(await formatFile(f)).toContain("normalized");
	expect(readFileSync(f, "utf8")).toBe("a\nb\n");
});
