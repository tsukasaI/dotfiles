// Offline tests for pi/extensions/goal.ts (the evaluator is injected; no model calls).
// Run: bun test pi/tests
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logDir = mkdtempSync(join(tmpdir(), "goal-usage-"));
const prevLogDir = process.env.PI_USAGE_LOG_DIR;
process.env.PI_USAGE_LOG_DIR = logDir;
afterAll(() => {
	if (prevLogDir === undefined) delete process.env.PI_USAGE_LOG_DIR;
	else process.env.PI_USAGE_LOG_DIR = prevLogDir;
});

const g = await import("../extensions/goal.ts");

const usage = { input: 900, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 920, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } };
const reply = { role: "assistant", provider: "anthropic", model: "claude-haiku-5-5", stopReason: "stop", content: [], usage };

function harness(evaluate: g.Evaluate) {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, any> = {};
	const appended: any[] = [];
	const sent: string[] = [];
	const notes: string[] = [];
	const pi: any = {
		on: (ev: string, h: Function) => (handlers[ev] = h),
		registerCommand: (name: string, c: any) => (commands[name] = c),
		appendEntry: (type: string, data: any) => appended.push({ type: "custom", customType: type, data: structuredClone(data) }),
		sendUserMessage: async (text: string) => void sent.push(text),
	};
	g.default(pi, evaluate);
	const ctx: any = {
		hasUI: true,
		cwd: "/repo",
		ui: { notify: (t: string) => notes.push(t), setStatus: () => {} },
		sessionManager: { getBranch: () => appended, getSessionId: () => "s1" },
		waitForIdle: async () => {},
	};
	// pi previews the context before our entries: it ends with the assistant reply,
	// so canContinue is false even though the appended custom message makes continuing valid.
	const settle = (outcome = "completed") =>
		handlers.agent_before_settle(
			{ type: "agent_before_settle", entries: [], continue: false, outcome, context: { llmMessages: [{ role: "user", content: "go" }, { role: "assistant", content: [{ type: "text", text: "ok" }] }], canContinue: false } },
			ctx,
		);
	return { commands, appended, sent, notes, ctx, settle, handlers };
}

const verdict = (met: boolean, reason = "r"): g.Evaluate => async () => ({ verdict: { met, reason }, reply });

beforeEach(() => {
	delete process.env.PI_SUBAGENT;
});

describe("goal loop", () => {
	test("met: stops, records the result and the evaluator's usage", async () => {
		const h = harness(verdict(true, "tests pass"));
		await h.commands.goal.handler("make tests pass", h.ctx);
		expect(h.sent).toEqual(["make tests pass"]);
		expect(h.appended[0].data).toMatchObject({ active: true, turns: 0, maxTurns: g.DEFAULT_MAX_TURNS });
		const res = await h.settle();
		expect(res.continue).toBeUndefined();
		expect(res.entries).toHaveLength(1);
		expect(res.entries[0].data).toMatchObject({ active: false, result: "met", turns: 1, reason: "tests pass", evalUsage: usage });
		const lines = readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), "utf8").trim().split("\n"));
		expect(JSON.parse(lines.at(-1)!)).toMatchObject({ sessionId: "s1", model: "claude-haiku-5-5", turnIndex: -1, cost: { total: 0.001 } });
	});

	test("not met: continues once with the reason and the condition", async () => {
		const h = harness(verdict(false, "2 tests fail"));
		await h.commands.goal.handler("make tests pass", h.ctx);
		const res = await h.settle();
		expect(res.continue).toBe(true);
		expect(res.entries[0].data).toMatchObject({ active: true, turns: 1 });
		expect(res.entries[1]).toMatchObject({ type: "custom_message", customType: "goal-continue", display: true });
		expect(res.entries[1].content).toContain("2 tests fail");
		expect(res.entries[1].content).toContain("make tests pass");
	});

	test("turn cap: stops at --max even when not met", async () => {
		const h = harness(verdict(false));
		await h.commands.goal.handler("--max 2 do it", h.ctx);
		expect((await h.settle()).continue).toBe(true);
		const res = await h.settle();
		expect(res.continue).toBeUndefined();
		expect(res.entries[0].data).toMatchObject({ active: false, result: "limit", turns: 2 });
		expect(await h.settle()).toBeUndefined();
	});

	test("evaluation failure (throw, error, no verdict) stops fail-closed", async () => {
		for (const ev of [
			async () => {
				throw new Error("network down");
			},
			async () => ({ error: "overloaded", reply }),
			async () => ({}),
		] as g.Evaluate[]) {
			const h = harness(ev);
			await h.commands.goal.handler("x", h.ctx);
			const res = await h.settle();
			expect(res.continue).toBeUndefined();
			expect(res.entries[0].data).toMatchObject({ active: false, result: "eval-failed" });
		}
	});

	test("aborted run stops without calling the evaluator", async () => {
		let called = false;
		const h = harness(async () => ((called = true), { verdict: { met: false, reason: "" } }));
		await h.commands.goal.handler("x", h.ctx);
		const res = await h.settle("aborted");
		expect(res.entries[0].data).toMatchObject({ active: false, result: "aborted" });
		expect(called).toBe(false);
	});

	test("/goal stop ends the loop; later settles do nothing", async () => {
		const h = harness(verdict(false));
		await h.commands.goal.handler("x", h.ctx);
		await h.commands.goal.handler("stop", h.ctx);
		expect(h.appended.at(-1).data).toMatchObject({ active: false, result: "stopped", evalUsage: undefined });
		expect(await h.settle()).toBeUndefined();
	});

	test("state is restored from the branch on session_start", async () => {
		const h = harness(verdict(false));
		h.appended.push({ type: "custom", customType: "goal", data: { condition: "c", maxTurns: 3, turns: 2, active: true } });
		await h.handlers.session_start({}, h.ctx);
		const res = await h.settle();
		expect(res.entries[0].data).toMatchObject({ result: "limit", turns: 3 });
	});

	test("children do not register /goal", () => {
		process.env.PI_SUBAGENT = "1";
		const h = { n: 0 };
		g.default({ on: () => h.n++, registerCommand: () => h.n++ } as any);
		expect(h.n).toBe(0);
	});
});

describe("goal helpers", () => {
	test("parseArgs", () => {
		expect(g.parseArgs("  ")).toEqual({ kind: "status" });
		expect(g.parseArgs("stop")).toEqual({ kind: "stop" });
		expect(g.parseArgs("--max=5 do x")).toEqual({ kind: "start", condition: "do x", maxTurns: 5 });
		expect(g.parseArgs("do x, or stop after 45 turns.")).toMatchObject({ maxTurns: 45 });
		expect(g.parseArgs("--max 3 do x or stop after 45 turns")).toMatchObject({ maxTurns: 3 });
		expect(g.parseArgs("--max 0 x").kind).toBe("error");
		expect(g.parseArgs("--max 4").kind).toBe("error");
	});

	test("parseVerdict is strict", () => {
		expect(g.parseVerdict('{"met": true, "reason": "ok"}')).toEqual({ met: true, reason: "ok" });
		expect(g.parseVerdict('Sure: {"met": false}')).toEqual({ met: false, reason: "" });
		expect(g.parseVerdict('{"met": "yes"}')).toBeUndefined();
		expect(g.parseVerdict("yes")).toBeUndefined();
		expect(g.parseVerdict("{broken")).toBeUndefined();
	});

	test("transcript keeps text, tool calls, clipped results; drops thinking; keeps the tail", () => {
		const long = `HEAD${"x".repeat(5000)}TAIL`;
		const t = g.renderTranscript([
			{ role: "user", content: "start" },
			{ role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "toolCall", name: "bash", arguments: { command: "bun test" } }] },
			{ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: long }] },
			{ role: "assistant", content: [{ type: "text", text: "done" }] },
		]);
		expect(t).toContain("[user]\nstart");
		expect(t).toContain('[tool call: bash]\n{"command":"bun test"}');
		expect(t).toContain("[tool result: bash, error]\nHEAD");
		expect(t).toContain("TAIL");
		expect(t).toContain("chars omitted");
		expect(t).not.toContain("secret");
		expect(t.endsWith("[assistant]\ndone")).toBe(true);
		const cut = g.renderTranscript([{ role: "user", content: "a".repeat(100) }, { role: "user", content: "END" }], 20);
		expect(cut.startsWith("…[earlier transcript omitted]…")).toBe(true);
		expect(cut.endsWith("END")).toBe(true);
	});
});
