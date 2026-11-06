// Offline tests for pi/extensions/shguard.ts. Run: bun test pi/tests
// The last test calls the real shguard binary when it is on PATH.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import shguard, { checkCommand, hookPayload, parseVerdict } from "../extensions/shguard.ts";

const answer = (permissionDecision?: string, permissionDecisionReason?: string) =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } });

describe("hookPayload", () => {
	test("is a Bash PreToolUse input carrying the command verbatim", () => {
		const cmd = 'git commit -m "a\nb" \'$x\'';
		expect(JSON.parse(hookPayload(cmd))).toEqual({ tool_name: "Bash", tool_input: { command: cmd }, hook_event_name: "PreToolUse" });
	});
});

describe("parseVerdict", () => {
	test("allow passes", () => {
		expect(parseVerdict(answer("allow", "covered by the catalog; no rule hit"))).toEqual({ allow: true });
	});
	test("deny carries the reason", () => {
		expect(parseVerdict(answer("deny", "rule `git-push-force` hit (item 0, link 0, cmd 0)"))).toEqual({
			allow: false,
			reason: "shguard: deny (rule `git-push-force` hit (item 0, link 0, cmd 0))",
		});
	});
	test("ask blocks: pi cannot answer one", () => {
		expect(parseVerdict(answer("ask", "no catalog row matches the command"))).toEqual({
			allow: false,
			reason: "shguard: ask (no catalog row matches the command)",
		});
	});
	test("no decision, other spellings, the 0.9 check shape, and garbage all block", () => {
		expect(parseVerdict(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse" } })).allow).toBe(false);
		expect(parseVerdict(answer("Allow")).allow).toBe(false);
		expect(parseVerdict(JSON.stringify({ decision: "Allow" })).allow).toBe(false);
		expect(parseVerdict(JSON.stringify({ hookSpecificOutput: "allow" })).allow).toBe(false);
		expect(parseVerdict("null").allow).toBe(false);
		expect(parseVerdict("not json").allow).toBe(false);
		expect(parseVerdict("").allow).toBe(false);
	});
});

describe("checkCommand", () => {
	test("sends the hook payload on stdin", async () => {
		let sent = "";
		await checkCommand("ls -la", async (stdin) => ((sent = stdin), { stdout: answer("allow") }));
		expect(JSON.parse(sent).tool_input.command).toBe("ls -la");
	});
	test("a failed run with no output blocks", async () => {
		const v = await checkCommand("ls", async () => ({ stdout: "", error: new Error("spawn shguard ENOENT") }));
		expect(v).toEqual({ allow: false, reason: "shguard did not run: spawn shguard ENOENT" });
	});
	test("a nonzero exit with an answer uses the answer", async () => {
		const v = await checkCommand("rm -rf x", async () => ({ stdout: answer("deny", "rm"), error: new Error("exit 2") }));
		expect(v).toEqual({ allow: false, reason: "shguard: deny (rm)" });
	});
});

describe("extension", () => {
	function handlerWith(stdout: string) {
		let h: Function | undefined;
		const seen: string[] = [];
		shguard({ on: (_e: string, fn: Function) => (h = fn) } as any, async (stdin) => (seen.push(JSON.parse(stdin).tool_input.command), { stdout }));
		return { call: (event: any) => h!(event, {}), seen };
	}
	test("only bash is checked", async () => {
		const { call, seen } = handlerWith(answer("deny"));
		expect(await call({ toolName: "read", input: { path: "x" } })).toBeUndefined();
		expect(seen).toEqual([]);
	});
	test("allowed bash passes, denied bash is blocked with the reason", async () => {
		expect(await handlerWith(answer("allow")).call({ toolName: "bash", input: { command: "ls" } })).toBeUndefined();
		const res = await handlerWith(answer("deny", "r")).call({ toolName: "bash", input: { command: "git push -f" } });
		expect(res).toEqual({ block: true, reason: "shguard: deny (r)" });
	});
	test("$HOME is checked and run as the literal path; a blocked command is left as written", async () => {
		const home = process.env.HOME!;
		const ok = handlerWith(answer("allow"));
		const input = { command: 'ls "$HOME/x" ${HOME}/y' };
		expect(await ok.call({ toolName: "bash", input })).toBeUndefined();
		expect(ok.seen).toEqual([`ls "${home}/x" ${home}/y`]);
		expect(input.command).toBe(`ls "${home}/x" ${home}/y`);
		const blocked = { command: "cat $HOME/.netrc" };
		await handlerWith(answer("deny")).call({ toolName: "bash", input: blocked });
		expect(blocked.command).toBe("cat $HOME/.netrc");
	});
	test("a bash call without a command string is blocked", async () => {
		expect((await handlerWith(answer("allow")).call({ toolName: "bash", input: {} })).block).toBe(true);
	});
});

let hasShguard = true;
try {
	execFileSync("shguard", ["--version"]);
} catch {
	hasShguard = false;
}
// Commands whose decision does not depend on the shguard version or on
// ask_outcome, so this holds before and after a shguard upgrade.
test.skipIf(!hasShguard)("real shguard: plain push allowed, force push blocked", async () => {
	expect(await checkCommand("git push origin feat/x")).toEqual({ allow: true });
	expect((await checkCommand("git push --force origin main")).allow).toBe(false);
});
