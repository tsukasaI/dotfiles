import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

// CommonMark fences, not a /```[\s\S]*?```/ regex: a block that quotes a
// ``` fence inside a longer ```` fence must come out whole.
export function extractCodeBlocks(markdown: string): string[] {
	const lines = markdown.split("\n");
	const blocks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = OPEN.exec(lines[i] ?? "");
		if (!open) continue;
		const [, indent = "", fence = "", info = ""] = open;
		if (fence[0] === "`" && info.includes("`")) continue;
		const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length && !close.test(lines[j] ?? ""); j++) {
			const line = lines[j] ?? "";
			const strip = Math.min(indent.length, line.length - line.trimStart().length);
			body.push(line.slice(strip));
		}
		blocks.push(body.join("\n"));
		i = j;
	}
	return blocks;
}

export function assistantText(message: any): string {
	if (message?.role !== "assistant") return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((c: any) => c?.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

export function latestBlocks(entries: any[]): string[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const blocks = extractCodeBlocks(assistantText(entry.message));
		if (blocks.length > 0) return blocks;
	}
	return [];
}

export type Pick = { ok: true; text: string; index: number; total: number } | { ok: false; error: string };

export function pickBlock(blocks: string[], arg: string): Pick {
	if (blocks.length === 0) return { ok: false, error: "No code block found in this branch's assistant messages" };
	const raw = arg.trim();
	if (raw === "") {
		let best = 0;
		blocks.forEach((b, i) => {
			if (b.length > (blocks[best] ?? "").length) best = i;
		});
		return { ok: true, text: blocks[best] ?? "", index: best + 1, total: blocks.length };
	}
	if (!/^\d+$/.test(raw)) return { ok: false, error: `Usage: /copy-code [n] (got "${raw}")` };
	const n = Number(raw);
	if (n < 1 || n > blocks.length) return { ok: false, error: `Block ${n} does not exist (1-${blocks.length})` };
	return { ok: true, text: blocks[n - 1] ?? "", index: n, total: blocks.length };
}

function pbcopy(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (d) => (stderr += d));
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `pbcopy exited ${code}`))));
		child.stdin.end(text);
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copy-code", {
		description: "Copy a fenced code block from the latest assistant reply that has one: /copy-code [n] (default: the longest)",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "warning" | "error") =>
				ctx.hasUI ? ctx.ui.notify(text, level) : console.log(text);
			const picked = pickBlock(latestBlocks(ctx.sessionManager.getBranch()), args ?? "");
			if (!picked.ok) return notify(picked.error, "warning");
			try {
				await pbcopy(picked.text);
			} catch (err) {
				return notify(`copy-code: ${(err as Error).message}`, "error");
			}
			const lines = picked.text === "" ? 0 : picked.text.split("\n").length;
			notify(`Copied block ${picked.index}/${picked.total} (${lines} lines)`, "info");
		},
	});
}
