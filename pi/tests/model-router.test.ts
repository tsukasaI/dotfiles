// Offline tests for pi/extensions/model-router.ts (no model calls). Run: bun test pi/tests
import { describe, expect, test } from "bun:test";
import { lastUserText, parseTier, route, TIER_MODEL } from "../extensions/model-router.ts";

const model = (id: string, provider = "anthropic") => ({ id, provider });
const ctx: any = { modelRegistry: { find: (provider: string, id: string) => model(id, provider) } };
const user = (text: string) => ({ role: "user", content: text, timestamp: 0 });

function rater(answer: string | undefined | Error) {
	const calls: { prompt: string; current: string | undefined }[] = [];
	return {
		calls,
		deps: {
			rate: async (prompt: string, current: any) => {
				calls.push({ prompt, current });
				if (answer instanceof Error) throw answer;
				return answer === undefined ? undefined : parseTier(answer);
			},
		},
	};
}

describe("parseTier / lastUserText", () => {
	test("first tier word wins, case-insensitive; none gives undefined", () => {
		expect(parseTier("Heavy")).toBe("heavy");
		expect(parseTier("light.")).toBe("light");
		expect(parseTier("I think standard")).toBe("standard");
		expect(parseTier("medium")).toBeUndefined();
		expect(parseTier("")).toBeUndefined();
	});
	test("takes the latest user message, text blocks only", () => {
		const msgs: any = [
			user("old"),
			{ role: "assistant", content: [] },
			{ role: "user", content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] },
		];
		expect(lastUserText(msgs)).toBe("a\nb");
		expect(lastUserText([])).toBe("");
	});
});

describe("route", () => {
	test("a user turn is rated and routed; the thinking level passes through", async () => {
		const r = rater("heavy");
		const res = await route({ reason: "user", thinkingLevel: "high", messages: [user("redesign the auth layer")] }, ctx, r.deps);
		expect(res).toEqual({ model: model(TIER_MODEL.heavy), thinkingLevel: "high", state: { tier: "heavy" } });
		expect(r.calls).toEqual([{ prompt: "redesign the auth layer", current: undefined }]);
	});
	test("an unchanged tier keeps the stored state (no new state object)", async () => {
		const r = rater("light");
		const res = await route({ reason: "user", thinkingLevel: "low", state: { tier: "light" }, messages: [user("ok")] }, ctx, r.deps);
		expect(res.model).toEqual(model(TIER_MODEL.light));
		expect(res.state).toBeUndefined();
		expect(r.calls[0].current).toBe("light");
	});
	test("rating failure, garbage, or a thrown error falls back to Sonnet", async () => {
		for (const answer of [undefined, "dunno", new Error("network")]) {
			const res = await route({ reason: "user", thinkingLevel: "medium", messages: [user("x")] }, ctx, rater(answer).deps);
			expect(res.model).toEqual(model(TIER_MODEL.standard));
		}
	});
	test("continuations and retries stay on the model that handled the turn, without rating", async () => {
		const r = rater("heavy");
		const prev = { model: model(TIER_MODEL.light) };
		expect((await route({ reason: "continuation", thinkingLevel: "low", previous: prev, messages: [] }, ctx, r.deps)).model).toBe(prev.model);
		const failed = { model: model(TIER_MODEL.standard), message: {} };
		expect((await route({ reason: "retry", thinkingLevel: "low", failed, messages: [] }, ctx, r.deps)).model).toBe(failed.model);
		expect(r.calls).toEqual([]);
	});
	test("a continuation after a non-Anthropic model falls back to the stored tier", async () => {
		const res = await route(
			{ reason: "continuation", thinkingLevel: "low", previous: { model: model("gpt-x", "openai") }, state: { tier: "heavy" }, messages: [] },
			ctx,
			rater("light").deps,
		);
		expect(res.model).toEqual(model(TIER_MODEL.heavy));
	});
	test("direct requests (compaction summaries) go to Sonnet", async () => {
		const res = await route({ reason: "direct", thinkingLevel: "off", messages: [] }, ctx, rater("heavy").deps);
		expect(res.model).toEqual(model(TIER_MODEL.standard));
	});
	test("a model missing from the catalog is an error, not a silent fallback", async () => {
		const noCatalog: any = { modelRegistry: { find: () => undefined } };
		await expect(route({ reason: "direct", thinkingLevel: "off", messages: [] }, noCatalog, rater("x").deps)).rejects.toThrow("not in the catalog");
	});
});
