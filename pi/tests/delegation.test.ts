// Offline tests for pi/extensions/subagent.ts and advisor.ts (no model calls,
// no child processes). Run: bun test pi/tests
import { afterEach, describe, expect, mock, test } from "bun:test";

// pi-ai is supplied by pi at runtime and is not installed in this repo; the
// schema builders only need to return something registerTool can hold.
const schema = (kind: string) => (...args: any[]) => ({ kind, args });
mock.module("@earendil-works/pi-ai", () => ({
	Type: { Object: schema("object"), Array: schema("array"), String: schema("string"), Optional: schema("optional") },
}));

const sub = await import("../extensions/subagent.ts");
const adv = await import("../extensions/advisor.ts");

const assistant = (text: string, cost: number, extra: object = {}) =>
	JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } }, ...extra },
	});

function fakeSpawner(lines: string[], result: { code: number | null; stderr?: string; aborted?: boolean } = { code: 0 }) {
	const calls: { args: string[]; cwd: string }[] = [];
	const spawner: any = async (args: string[], opts: any) => {
		calls.push({ args, cwd: opts.cwd });
		for (const l of lines) opts.onLine(l);
		return { stderr: "", aborted: false, ...result };
	};
	return { spawner, calls };
}

function registered(factory: (pi: any) => void) {
	const tools: any[] = [];
	factory({ registerTool: (t: any) => tools.push(t) });
	return tools;
}

afterEach(() => {
	delete process.env.PI_SUBAGENT;
});

describe("subagent", () => {
	test("collector sums usage over turns, keeps the last text, ignores junk", () => {
		const c = new sub.EventCollector();
		c.feed("not json");
		c.feed(JSON.stringify({ type: "tool_execution_start", toolName: "read" }));
		c.feed(assistant("thinking about it", 0.01));
		c.feed(JSON.stringify({ type: "message_end", message: { role: "user" } }));
		c.feed(assistant("final report", 0.02));
		expect(c.turns).toBe(2);
		expect(c.lastText).toBe("final report");
		expect(c.lastTool).toBe("read");
		expect(c.usage.cost.total).toBeCloseTo(0.03, 6);
		expect(c.usage.cacheRead).toBe(200);
	});

	test("child args pin the agent's model, thinking, tools, and prompt", () => {
		const args = sub.childArgs(sub.AGENTS.scout, "find X");
		expect(args.slice(0, 4)).toEqual(["--mode", "json", "-p", "--no-session"]);
		expect(args).toContain("anthropic/claude-haiku-5-5");
		expect(args[args.indexOf("--tools") + 1]).toBe("read,grep,find,ls,bash");
		expect(args.at(-1)).toBe("Task: find X");
		expect(sub.AGENTS.worker.tools).toContain("edit");
		expect(sub.AGENTS.research.tools).not.toContain("edit");
	});

	test("task validation", () => {
		expect(sub.checkTasks([])).toContain("1-4");
		expect(sub.checkTasks(Array(5).fill({ agent: "scout", task: "x" }))).toContain("1-4");
		expect(sub.checkTasks([{ agent: "planner", task: "x" }])).toContain("unknown agent");
		expect(sub.checkTasks([{ agent: "worker", task: "a" }, { agent: "worker", task: "b" }])).toContain("one worker");
		expect(sub.checkTasks([{ agent: "scout", task: "  " }])).toContain("non-empty");
		expect(sub.checkTasks([{ agent: "scout", task: "a" }, { agent: "worker", task: "b" }])).toBeUndefined();
	});

	test("runTask: success, nonzero exit, model error, and no output", async () => {
		const ok = await sub.runTask("scout", "t", "/repo", fakeSpawner([assistant("found it", 0.001)]).spawner);
		expect(ok).toMatchObject({ ok: true, text: "found it", model: "claude-haiku-5-5", turns: 1 });
		const exit = await sub.runTask("scout", "t", "/repo", fakeSpawner([], { code: 1, stderr: "boom" }).spawner);
		expect(exit).toMatchObject({ ok: false, error: "exit 1: boom" });
		const err = await sub.runTask("scout", "t", "/repo", fakeSpawner([assistant("", 0, { stopReason: "error", errorMessage: "overloaded" })]).spawner);
		expect(err).toMatchObject({ ok: false, error: "overloaded" });
		const aborted = await sub.runTask("scout", "t", "/repo", fakeSpawner([], { code: null, aborted: true }).spawner);
		expect(aborted.error).toBe("aborted");
	});

	test("tool: runs tasks in the session cwd, aggregates usage, reports per agent", async () => {
		const { spawner, calls } = fakeSpawner([assistant("report", 0.005)]);
		const [tool] = registered((pi) => sub.default(pi, spawner));
		expect(tool.name).toBe("subagent");
		const res = await tool.execute("id", { tasks: [{ agent: "scout", task: "a" }, { agent: "research", task: "b" }] }, undefined, undefined, { cwd: "/repo" });
		expect(calls.map((c) => c.cwd)).toEqual(["/repo", "/repo"]);
		expect(res.usage.cost.total).toBeCloseTo(0.01, 6);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("## scout (claude-haiku-5-5) done");
		expect(res.content[0].text).toContain("## research (claude-sonnet-5-5) done");
	});

	test("tool: invalid tasks throw before spawning anything", async () => {
		const { spawner, calls } = fakeSpawner([]);
		const [tool] = registered((pi) => sub.default(pi, spawner));
		await expect(tool.execute("id", { tasks: [{ agent: "worker", task: "a" }, { agent: "worker", task: "b" }] }, undefined, undefined, { cwd: "/r" })).rejects.toThrow("one worker");
		expect(calls).toEqual([]);
	});

	test("children register neither tool (no recursion)", () => {
		process.env.PI_SUBAGENT = "1";
		expect(registered((pi) => sub.default(pi))).toEqual([]);
		expect(registered((pi) => adv.default(pi))).toEqual([]);
	});
});

describe("advisor", () => {
	const params = { goal: "G", background: "B", problem: "P", attempts: " ", question: "Q?" };

	test("brief keeps section order and drops empty optional sections", () => {
		expect(adv.formatBrief(params)).toBe("## Goal\nG\n\n## Background\nB\n\n## Problem to solve\nP\n\n## Question\nQ?");
	});

	test("cost estimate uses the catalog rates and the output cap", () => {
		const est = adv.estimateCost("x".repeat(3000), { input: 10, output: 50 });
		expect(est.outputCap).toBeCloseTo((adv.MAX_OUTPUT_TOKENS * 50) / 1e6, 6);
		expect(est.input).toBeGreaterThan((1000 * 10) / 1e6);
	});

	function ctxWith(opts: { hasUI: boolean; confirm?: boolean; reply?: any }) {
		const seen: any = {};
		return {
			seen,
			ctx: {
				hasUI: opts.hasUI,
				ui: { confirm: async (title: string, msg: string) => ((seen.confirm = { title, msg }), opts.confirm ?? false) },
				modelRegistry: {
					find: (_p: string, id: string) => ({ id, cost: { input: 10, output: 50 } }),
					streamSimple: (model: any, context: any, options: any) => {
						seen.call = { model, context, options };
						return { result: async () => opts.reply };
					},
				},
			},
		};
	}

	test("refuses without a UI and when the user declines; never calls the model", async () => {
		const [tool] = registered((pi) => adv.default(pi));
		const noUi = ctxWith({ hasUI: false });
		await expect(tool.execute("id", params, undefined, undefined, noUi.ctx)).rejects.toThrow("confirmation");
		const declined = ctxWith({ hasUI: true, confirm: false });
		await expect(tool.execute("id", params, undefined, undefined, declined.ctx)).rejects.toThrow("declined");
		expect(declined.seen.confirm.msg).toContain("## Problem to solve");
		expect(noUi.seen.call).toBeUndefined();
		expect(declined.seen.call).toBeUndefined();
	});

	test("approved: sends only the brief to Fable and returns its advice with usage", async () => {
		const usage = { input: 500, output: 800, cacheRead: 0, cacheWrite: 0, totalTokens: 1300, cost: { total: 0.045 } };
		const { ctx, seen } = ctxWith({ hasUI: true, confirm: true, reply: { stopReason: "stop", content: [{ type: "text", text: "Do A." }], usage } });
		const [tool] = registered((pi) => adv.default(pi));
		const res = await tool.execute("id", params, undefined, undefined, ctx);
		expect(seen.call.model.id).toBe("claude-fable-5-1");
		expect(seen.call.context.messages).toHaveLength(1);
		expect(seen.call.context.messages[0].content).toBe(adv.formatBrief(params));
		expect(seen.call.options.maxTokens).toBe(adv.MAX_OUTPUT_TOKENS);
		expect(res.content[0].text).toContain("Do A.");
		expect(res.usage).toBe(usage);
	});

	test("an error reply is a failed tool call", async () => {
		const { ctx } = ctxWith({ hasUI: true, confirm: true, reply: { stopReason: "error", errorMessage: "overloaded", content: [] } });
		const [tool] = registered((pi) => adv.default(pi));
		await expect(tool.execute("id", params, undefined, undefined, ctx)).rejects.toThrow("overloaded");
	});
});
