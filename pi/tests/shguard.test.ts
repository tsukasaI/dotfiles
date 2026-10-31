// Offline tests for pi/extensions/shguard.ts. Run: bun test pi/tests
// The last test calls the real shguard binary when it is on PATH.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import shguard, { checkCommand, parseVerdict } from "../extensions/shguard.ts";

const json = (o: object) => JSON.stringify(o);

describe("parseVerdict", () => {
	test("Allow passes", () => {
		expect(parseVerdict(json({ decision: "Allow" }))).toEqual({ allow: true });
	});
	test("Block carries the reason", () => {
		const v = parseVerdict(json({ decision: "Block", deny_message: null, reason: 'matches "git-push-force"' }));
		expect(v).toEqual({ allow: false, reason: 'shguard: Block (matches "git-push-force")' });
	});
	test("unknown decisions, missing decision, and garbage all block", () => {
		expect(parseVerdict(json({ decision: "Ask" })).allow).toBe(false);
		expect(parseVerdict(json({})).allow).toBe(false);
		expect(parseVerdict("not json").allow).toBe(false);
		expect(parseVerdict("").allow).toBe(false);
	});
});

describe("checkCommand", () => {
	test("a failed run with no output blocks", async () => {
		const v = await checkCommand("ls", async () => ({ stdout: "", error: new Error("spawn shguard ENOENT") }));
		expect(v).toEqual({ allow: false, reason: "shguard did not run: spawn shguard ENOENT" });
	});
	test("a nonzero exit with a verdict uses the verdict", async () => {
		const v = await checkCommand("rm -rf x", async () => ({ stdout: json({ decision: "Block", reason: "rm" }), error: new Error("exit 1") }));
		expect(v).toEqual({ allow: false, reason: "shguard: Block (rm)" });
	});
});

describe("extension", () => {
	function handlerWith(stdout: string) {
		let h: Function | undefined;
		const seen: string[] = [];
		shguard({ on: (_e: string, fn: Function) => (h = fn) } as any, async (cmd) => (seen.push(cmd), { stdout }));
		return { call: (event: any) => h!(event, {}), seen };
	}
	test("only bash is checked", async () => {
		const { call, seen } = handlerWith(json({ decision: "Block" }));
		expect(await call({ toolName: "read", input: { path: "x" } })).toBeUndefined();
		expect(seen).toEqual([]);
	});
	test("allowed bash passes, blocked bash is blocked with the reason", async () => {
		expect(await handlerWith(json({ decision: "Allow" })).call({ toolName: "bash", input: { command: "ls" } })).toBeUndefined();
		const res = await handlerWith(json({ decision: "Block", reason: "r" })).call({ toolName: "bash", input: { command: "git push -f" } });
		expect(res).toEqual({ block: true, reason: "shguard: Block (r)" });
	});
	test("a bash call without a command string is blocked", async () => {
		expect((await handlerWith(json({ decision: "Allow" })).call({ toolName: "bash", input: {} })).block).toBe(true);
	});
});

let hasShguard = true;
try {
	execFileSync("shguard", ["--version"]);
} catch {
	hasShguard = false;
}
test.skipIf(!hasShguard)("real shguard: reversible push allowed, force push and deletes blocked", async () => {
	expect((await checkCommand("git push origin feat/x")).allow).toBe(true);
	expect((await checkCommand("gh pr create --fill")).allow).toBe(true);
	expect((await checkCommand("git push --force origin main")).allow).toBe(false);
	expect((await checkCommand("gh repo delete foo")).allow).toBe(false);
});
