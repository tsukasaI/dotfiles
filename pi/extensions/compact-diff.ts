import { homedir } from "node:os";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text } from "@earendil-works/pi-tui";

type Renderers = Required<Pick<ToolRenderers, "renderCall" | "renderResult">> & ToolRenderers;

interface EditPreview {
	diff?: string;
	error?: string;
}

export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

export function displayPath(path: string, cwd: string, home = homedir()): string {
	const under = (root: string) => root !== "" && (path === root || path.startsWith(`${root}/`));
	if (under(cwd)) return path === cwd ? "." : path.slice(cwd.length + 1);
	if (under(home)) return `~${path.slice(home.length)}`;
	return path;
}

export function lineCount(content: string): number {
	if (content === "") return 0;
	return content.replace(/\n$/, "").split("\n").length;
}

const rawPath = (args: any): string | undefined => {
	const p = args?.file_path ?? args?.path;
	return typeof p === "string" ? p : undefined;
};

const header = (title: string, args: any, theme: Theme, cwd: string) => {
	const path = rawPath(args);
	return `${theme.fg("toolTitle", theme.bold(title))} ${path ? theme.fg("accent", displayPath(path, cwd)) : theme.fg("toolOutput", "...")}`;
};

const expandHint = (theme: Theme) =>
	` ${theme.fg("muted", "(")}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;

export function editSummaryLine(args: any, preview: EditPreview | undefined, theme: Theme, cwd: string): string {
	let text = header("edit", args, theme, cwd);
	if (preview?.error !== undefined) {
		text += ` ${theme.fg("error", preview.error.split("\n")[0] ?? "")}`;
	} else if (preview?.diff !== undefined) {
		const { added, removed } = diffStats(preview.diff);
		text += ` ${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}${expandHint(theme)}`;
	}
	return text;
}

export function writeSummaryLine(args: any, theme: Theme, cwd: string): string {
	const content = typeof args?.content === "string" ? args.content : undefined;
	let text = header("write", args, theme, cwd);
	if (content !== undefined) text += `${theme.fg("dim", ` (${lineCount(content)} lines)`)}${expandHint(theme)}`;
	return text;
}

// The built-in edit renderer draws the diff inside its call box and keeps its
// preview in ctx.state.callComponent, so it must still run while collapsed:
// skipping it would recompute the preview on expand against the already-edited
// file and show an "oldText not found" error instead of the diff.
function compactEdit(base: Renderers): ToolRenderers {
	return {
		...base,
		renderCall(args, theme, ctx) {
			const full = base.renderCall(args, theme, { ...ctx, lastComponent: ctx.state.callComponent });
			if (ctx.expanded) return full;
			const call = ctx.state.callComponent as { preview?: EditPreview; settledError?: boolean } | undefined;
			const failed = call?.preview?.error !== undefined || call?.settledError === true;
			const bg = failed ? "toolErrorBg" : call?.preview ? "toolSuccessBg" : "toolPendingBg";
			const box: Box = ctx.state.compactSummary ?? new Box(1, 1, (s: string) => s);
			ctx.state.compactSummary = box;
			box.setBgFn((s: string) => theme.bg(bg, s));
			box.setPaddingX(ctx.outputPad);
			box.clear();
			box.addChild(new Text(editSummaryLine(args, call?.preview, theme, ctx.cwd), 0, 0));
			return box;
		},
		renderResult(result, options, theme, ctx) {
			const full = base.renderResult(result, options, theme, { ...ctx, lastComponent: ctx.state.compactResult });
			ctx.state.compactResult = full;
			if (options.expanded || ctx.isError) return full;
			return new Container();
		},
	};
}

function compactWrite(base: Renderers): ToolRenderers {
	return {
		...base,
		renderCall(args, theme, ctx) {
			if (ctx.expanded) {
				const full = base.renderCall(args, theme, { ...ctx, lastComponent: ctx.state.compactCall });
				ctx.state.compactCall = full;
				return full;
			}
			return new Text(writeSummaryLine(args, theme, ctx.cwd), 0, 0);
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		if (toolName !== "edit" && toolName !== "write") return next();
		const base = next();
		if (!base?.renderCall || !base.renderResult) return base;
		return toolName === "edit" ? compactEdit(base as Renderers) : compactWrite(base as Renderers);
	});
}
