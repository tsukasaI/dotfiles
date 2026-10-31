// Offline tests for pi/extensions/statusline.ts. Run: bun test pi/tests
import { describe, expect, mock, test } from "bun:test";

// pi-tui is supplied by pi at runtime and is not installed in this repo.
mock.module("@earendil-works/pi-tui", () => ({
	truncateToWidth: (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}\x1b[0m…\x1b[0m` : s),
	colorToRgb: (c: any) => c,
	mixColors: (a: any, b: any, t: number) => ({ kind: "rgb", r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }),
}));
const { renderLines, sessionTotals, abbreviateHome, parseRateLimit, segmentTheme, modelLabel } = await import("../extensions/statusline.ts");

// Tag each span so tests can assert which role was used:
// [role]text for a segment, >from/to for an arrow (to "-" = terminal background).
const theme = {
	paint: (role: string, text: string) => `[${role}]${text}`,
	arrow: (from: string, to: string | undefined) => `>${from}/${to ?? "-"}`,
};
const seg = (role: string, text: string) => `[${role}] ${text} `;
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

	test("cwd stands out; the rest alternates two quiet shades", () => {
		const [r1, r2, r3] = renderLines({ ...base, cwd: `${process.env.HOME}/dotfiles` }, theme, 500);
		expect(r1).toBe(
			`${seg("cwd", "» ~/dotfiles")}>cwd/quiet` +
				`${seg("quiet", "⎇ main")}>quiet/quiet2` +
				`${seg("quiet2", "◇ claude-opus-5-5")}>quiet2/quiet` +
				`${seg("quiet", "↯ medium")}>quiet/-`,
		);
		expect(r2).toBe(
			`${seg("quiet", "▰▰▱▱▱▱▱▱▱▱ 23.4% / 200.0k")}>quiet/quiet2` +
				`${seg("quiet2", "≡ 12.3k↓ 678↑")}>quiet2/quiet` +
				`${seg("quiet", "$0.12 · today $1.50 · month $12.30")}>quiet/-`,
		);
		expect(r3).toBe(`${seg("quiet", "checkpoint #1 abcd1234")}>quiet/-`);
	});

	test("third row is omitted when there is no rate limit or status", () => {
		expect(renderLines({ ...base, statuses: [] }, theme, 500)).toHaveLength(2);
	});

	test("a full reset inside a status does not clear the segment background", () => {
		const [, , r3] = renderLines({ ...base, statuses: ["\x1b[32mok\x1b[0m"] }, theme, 500);
		expect(r3).not.toContain("\x1b[0m");
		expect(r3).toContain("\x1b[32mok\x1b[39m");
	});

	test("context escalates to warn/crit; the next quiet segment still alternates", () => {
		const warn = renderLines({ ...base, contextPercent: 75 }, theme, 500)[1];
		expect(warn).toStartWith(`${seg("warn", "▰▰▰▰▰▰▰▰▱▱ 75.0% / 200.0k")}>warn/quiet`);
		expect(renderLines({ ...base, contextPercent: 95 }, theme, 500)[1]).toStartWith("[crit]");
		expect(renderLines({ ...base, contextPercent: 69.9 }, theme, 500)[1]).toStartWith("[quiet]");
		expect(renderLines({ ...base, contextPercent: null }, theme, 500)[1]).toStartWith("[quiet] ▱▱▱▱▱▱▱▱▱▱ ?%");
	});

	test("omits missing branch/model and truncates to width", () => {
		const [r1] = renderLines({ ...base, branch: null, model: undefined }, theme, 500);
		expect(r1).not.toContain("⎇");
		expect(r1).not.toContain("◇");
		for (const line of renderLines(base, theme, 20)) expect(line.replaceAll("\x1b[0m", "").length).toBeLessThanOrEqual(20);
	});

	test("running tools: first name plus count, quiet", () => {
		const r1 = renderLines({ ...base, runningTools: ["bash"] }, theme, 500)[0];
		expect(r1).toContain(`>quiet/quiet2${seg("quiet2", "⚙ bash")}`);
		expect(renderLines({ ...base, runningTools: ["bash", "read", "edit"] }, theme, 500)[0]).toContain("⚙ bash +2");
	});

	test("segmentTheme picks readable text for vivid backgrounds and arrows use the backgrounds", () => {
		const rgb = (r: number, g: number, b: number) => ({ kind: "rgb", r, g, b });
		const calls: any[] = [];
		const piTheme = {
			colors: { mdLink: rgb(102, 157, 241), toolPendingBg: rgb(43, 43, 43), text: rgb(170, 176, 183), warning: rgb(193, 150, 45), error: rgb(120, 20, 20) },
			style: (text: string, opts: any) => (calls.push({ text, ...opts }), text),
		};
		const st = segmentTheme(piTheme);
		st.paint("cwd", "x");
		st.paint("crit", "x");
		st.paint("quiet", "x");
		st.arrow("cwd", "quiet");
		st.arrow("quiet2", undefined);
		expect(calls[0]).toMatchObject({ fg: { r: 16, g: 18, b: 22 }, bg: piTheme.colors.mdLink }); // dark text on light blue
		expect(calls[1]).toMatchObject({ fg: { r: 255, g: 255, b: 255 }, bg: piTheme.colors.error }); // white on dark red
		expect(calls[2]).toMatchObject({ fg: piTheme.colors.text, bg: piTheme.colors.toolPendingBg });
		expect(calls[3]).toMatchObject({ fg: piTheme.colors.mdLink, bg: piTheme.colors.toolPendingBg });
		expect(calls[4].bg).toBeUndefined();
		expect(calls[4].fg).not.toEqual(piTheme.colors.toolPendingBg); // the second quiet shade differs from the first
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
		const [, r2, r3] = renderLines({ ...base, rateLimit: rl }, theme, 500);
		expect(r2).not.toContain("RL");
		expect(r3).toBe(`${seg("warn", "RL in 80%")}>warn/quiet${seg("quiet", "checkpoint #1 abcd1234")}>quiet/-`);
		const low = renderLines({ ...base, rateLimit: { bucket: "req", usedPercent: 3 }, statuses: [] }, theme, 500)[2];
		expect(low).toBe(`${seg("quiet", "RL req 3%")}>quiet/-`);
		expect(renderLines({ ...base, rateLimit: { bucket: "tok", usedPercent: 95 } }, theme, 500)[2]).toStartWith("[crit]");
		expect(parseRateLimit({})).toBeUndefined();
		expect(parseRateLimit({ "anthropic-ratelimit-tokens-limit": "0", "anthropic-ratelimit-tokens-remaining": "0" })).toBeUndefined();
	});

	test("model label appends the routed model for router/auto only", () => {
		const msg = (provider: string, model: string) => ({ type: "message", message: { role: "assistant", provider, model } });
		const branch = [msg("anthropic", "claude-haiku-5-5"), { type: "message", message: { role: "user" } }, msg("anthropic", "claude-sonnet-5-5")];
		expect(modelLabel({ provider: "router", id: "auto" }, branch)).toBe("auto \u2192 claude-sonnet-5-5");
		expect(modelLabel({ provider: "router", id: "auto" }, [])).toBe("auto");
		expect(modelLabel({ provider: "anthropic", id: "claude-opus-5-5" }, branch)).toBe("claude-opus-5-5");
		expect(modelLabel(undefined, branch)).toBeUndefined();
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
