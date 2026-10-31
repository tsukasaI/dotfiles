// Offline tests for pi/extensions/statusline.ts. Run: bun test pi/tests
import { describe, expect, mock, test } from "bun:test";

// pi-tui is supplied by pi at runtime and is not installed in this repo.
mock.module("@earendil-works/pi-tui", () => ({
	truncateToWidth: (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s),
}));
const { renderLines, sessionTotals, abbreviateHome, parseRateLimit } = await import("../extensions/statusline.ts");

// Tag each colored span so tests can assert which theme color was used.
const theme = { fg: (color: string, text: string) => `<${color}>${text}` };
const base = {
	cwd: "/home/u/dotfiles",
	branch: "main",
	model: "claude-opus-5-5",
	thinking: "medium",
	contextPercent: 23.44,
	contextWindow: 200_000,
	input: 12_345,
	output: 678,
	sessionCost: 0.1234,
	todayCost: 1.5,
	monthCost: 12.3,
	runningTools: [] as string[],
	rateLimit: undefined as any,
	statuses: ["checkpoint #1 abcd1234"],
};

describe("statusline", () => {
	test("abbreviates home only at a path boundary", () => {
		expect(abbreviateHome("/home/u/dotfiles", "/home/u")).toBe("~/dotfiles");
		expect(abbreviateHome("/home/u", "/home/u")).toBe("~");
		expect(abbreviateHome("/home/user2/x", "/home/u")).toBe("/home/user2/x");
	});

	test("renders both rows with theme colors", () => {
		const [r1, r2] = renderLines({ ...base, cwd: `${process.env.HOME}/dotfiles` }, theme, 500);
		expect(r1).toBe("<accent>» ~/dotfiles<borderMuted> │ <text>⎇ main<borderMuted> │ <mdHeading>◇ claude-opus-5-5<borderMuted> │ <thinkingMedium>↯ medium");
		expect(r2).toContain("<success>▰▰▱▱▱▱▱▱▱▱ 23.4%<dim> / 200.0k");
		expect(r2).toContain("<muted>≡ 12.3k↓ 678↑");
		expect(r2).toContain("<warning>$0.12<dim> · today $1.50 · month $12.30");
		expect(r2).not.toContain("RL");
		expect(r1).not.toContain("⚙");
		expect(r2).toContain("checkpoint #1 abcd1234");
	});

	test("context color escalates and unknown context is shown as ?", () => {
		expect(renderLines({ ...base, contextPercent: 75 }, theme, 500)[1]).toContain("<warning>▰▰▰▰▰▰▰▰▱▱ 75.0%");
		expect(renderLines({ ...base, contextPercent: 95 }, theme, 500)[1]).toContain("<error>");
		expect(renderLines({ ...base, contextPercent: null }, theme, 500)[1]).toContain("?%");
	});

	test("omits missing branch/model and truncates to width", () => {
		const [r1] = renderLines({ ...base, branch: null, model: undefined }, theme, 500);
		expect(r1).not.toContain("⎇");
		expect(r1).not.toContain("◇");
		for (const line of renderLines(base, theme, 20)) expect(line.length).toBeLessThanOrEqual(20);
	});

	test("running tools: first name plus count", () => {
		expect(renderLines({ ...base, runningTools: ["bash"] }, theme, 500)[0]).toContain("<toolTitle>⚙ bash");
		expect(renderLines({ ...base, runningTools: ["bash", "read", "edit"] }, theme, 500)[0]).toContain("⚙ bash +2");
	});

	test("rate limit picks the most-used bucket and colors by threshold", () => {
		// Shape captured from a real Anthropic response (values changed).
		const h = {
			"anthropic-ratelimit-requests-limit": "13000",
			"anthropic-ratelimit-requests-remaining": "12999",
			"anthropic-ratelimit-input-tokens-limit": "10000000",
			"Anthropic-RateLimit-Input-Tokens-Remaining": "2000000",
			"anthropic-ratelimit-input-tokens-reset": "2026-10-31T03:49:33Z",
			"anthropic-ratelimit-output-tokens-limit": "2000000",
			"anthropic-ratelimit-output-tokens-remaining": "garbage",
		};
		const rl = parseRateLimit(h)!;
		expect(rl.bucket).toBe("in");
		expect(rl.usedPercent).toBeCloseTo(80, 5);
		expect(rl.reset).toBe("2026-10-31T03:49:33Z");
		expect(renderLines({ ...base, rateLimit: rl }, theme, 500)[1]).toContain("<warning>RL in 80%");
		expect(renderLines({ ...base, rateLimit: { bucket: "req", usedPercent: 3 } }, theme, 500)[1]).toContain("<muted>RL req 3%");
		expect(parseRateLimit({})).toBeUndefined();
		expect(parseRateLimit({ "anthropic-ratelimit-tokens-limit": "0", "anthropic-ratelimit-tokens-remaining": "0" })).toBeUndefined();
	});

	test("session totals include abandoned branches and nested tool usage", () => {
		const entries = [
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant", usage: { input: 10, output: 5, cost: { total: 0.01 } } } },
			{ type: "message", message: { role: "toolResult", usage: { cost: { total: 0.002 } } } },
			{ type: "compaction" },
			{ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cost: { total: 0.03 } } } },
		];
		const t = sessionTotals(entries);
		expect(t).toEqual({ input: 11, output: 6, cost: expect.closeTo(0.042, 6) });
	});
});
