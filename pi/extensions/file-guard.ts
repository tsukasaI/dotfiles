import { execFile } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PI_DIR, "..");
export const CLAUDE_SETTINGS = join(REPO, "claude-code", "settings.json");
const CONFIG_EDIT_HOOK = join(REPO, "claude-code", "hooks", "block-config-edit.sh");

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const EXTRA_READ_DENY = ["~/.pi/agent/auth.json"];
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

// Not path.resolve alone: pi's file tools also expand ~ and strip a leading @ before touching the path.
export function resolveToolPath(p: string, cwd: string, home = homedir()): string {
	let s = p.replace(UNICODE_SPACES, " ");
	if (s.startsWith("@")) s = s.slice(1);
	if (s === "~") s = home;
	else if (s.startsWith("~/")) s = join(home, s.slice(2));
	else if (s.startsWith("file://")) s = fileURLToPath(s);
	return resolve(cwd, s);
}

// Not realpath on the whole path: it fails for a file write is about to create.
/** Undefined for a dangling symlink, which writing through would create. */
export function canonicalPath(abs: string): string | undefined {
	let probe = abs;
	let tail = "";
	while (!existsSync(probe)) {
		try {
			if (lstatSync(probe).isSymbolicLink()) return undefined;
		} catch {
			// Not rethrown: a path that does not exist at all is the normal case here.
		}
		const parent = dirname(probe);
		if (parent === probe) break;
		tail = tail ? join(basename(probe), tail) : basename(probe);
		probe = parent;
	}
	const real = realpathSync(probe);
	return tail ? join(real, tail) : real;
}

/** gitignore-style glob (`**`, `*`, leading `~/`) to an anchored, case-insensitive regex. */
export function globToRegex(glob: string, home = homedir()): RegExp {
	let g = glob;
	let anchored = true;
	if (g.startsWith("~/")) g = join(home, g.slice(2));
	else if (!g.startsWith("/")) anchored = false;
	if (g.startsWith("**/")) {
		g = g.slice(3);
		anchored = false;
	}
	// `dir/**` also covers `dir` itself, so ls/grep/find on it are denied too.
	const subtree = g.endsWith("/**");
	if (subtree) g = g.slice(0, -3);
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			re += ".*";
			i++;
			if (g[i + 1] === "/") i++;
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`${anchored ? "^" : "(?:^|/)"}${re}${subtree ? "(?:/.*)?" : ""}$`, "i");
}

export function loadReadDeny(settingsPath = CLAUDE_SETTINGS, home = homedir()): RegExp[] {
	const deny = JSON.parse(readFileSync(settingsPath, "utf8"))?.permissions?.deny;
	if (!Array.isArray(deny)) throw new Error("permissions.deny is not a list");
	const globs = deny.flatMap((r: unknown) => {
		const m = typeof r === "string" ? /^Read\((.+)\)$/.exec(r) : null;
		return m ? [m[1]] : [];
	});
	if (globs.length === 0) throw new Error("no Read(...) rules in permissions.deny");
	return [...globs, ...EXTRA_READ_DENY].map((g) => globToRegex(g, home));
}

export function matchesAny(path: string, rules: RegExp[]): boolean {
	for (let p = path; ; p = dirname(p)) {
		if (rules.some((r) => r.test(p))) return true;
		if (dirname(p) === p) return false;
	}
}

export function isPiGuardFile(path: string, piDir = PI_DIR): boolean {
	const lower = path.toLowerCase();
	const own = ["extensions/file-guard.ts", "extensions/shguard.ts", "extensions/style-guards.ts", "settings.json", "pi-factory", "Dockerfile.pi"].map((f) => join(piDir, f).toLowerCase());
	if (own.includes(lower)) return true;
	return /\/\.pi\/(agent\/)?(settings\.json$|extensions(\/|$))/.test(lower);
}

export type HookRunner = (filePath: string) => Promise<{ code: number | null; stderr: string }>;

const runConfigEditHook: HookRunner = (filePath) =>
	new Promise((done) => {
		const child = execFile("bash", [CONFIG_EDIT_HOOK], { timeout: 10_000 }, (error, _stdout, stderr) => {
			const code = error ? (typeof (error as any).code === "number" ? (error as any).code : null) : 0;
			done({ code, stderr: String(stderr ?? "") });
		});
		child.stdin?.end(JSON.stringify({ tool_input: { file_path: filePath } }));
	});

export type Verdict = { block: true; reason: string } | undefined;

export async function checkWrite(abs: string, run: HookRunner = runConfigEditHook, piDir = PI_DIR): Promise<Verdict> {
	const real = canonicalPath(abs);
	if (real === undefined) return { block: true, reason: `file-guard: "${abs}" is a dangling symlink` };
	if (isPiGuardFile(abs, piDir) || isPiGuardFile(real, piDir))
		return { block: true, reason: `file-guard: "${abs}" defines pi's guardrails; ask the user to change it by hand` };
	const { code, stderr } = await run(abs);
	if (code === 0) return undefined;
	return { block: true, reason: stderr.trim() || `file-guard: block-config-edit.sh exited ${code ?? "abnormally"}` };
}

export function checkRead(abs: string, rules: RegExp[] | Error): Verdict {
	if (rules instanceof Error) return { block: true, reason: `file-guard: read deny list unavailable (${rules.message})` };
	let real: string | undefined;
	try {
		real = canonicalPath(abs);
	} catch {
		real = undefined;
	}
	if (matchesAny(abs, rules) || (real !== undefined && matchesAny(real, rules)))
		return { block: true, reason: `file-guard: "${abs}" matches a Read deny rule in claude-code/settings.json` };
	return undefined;
}

export default function fileGuard(pi: ExtensionAPI, run: HookRunner = runConfigEditHook, settingsPath = CLAUDE_SETTINGS) {
	let rules: RegExp[] | Error;
	try {
		rules = loadReadDeny(settingsPath);
	} catch (e) {
		rules = e instanceof Error ? e : new Error(String(e));
	}

	pi.on("tool_call", async (event, ctx) => {
		const isRead = READ_TOOLS.has(event.toolName);
		if (!isRead && !WRITE_TOOLS.has(event.toolName)) return undefined;
		const raw = (event.input as { path?: unknown }).path;
		if (raw !== undefined && typeof raw !== "string") return { block: true, reason: "file-guard: path is not a string" };
		// grep/find/ls default to the cwd; read/write/edit require a path.
		if (raw === undefined && !isRead) return { block: true, reason: "file-guard: missing path" };
		const abs = resolveToolPath(raw ?? ".", ctx.cwd);
		return isRead ? checkRead(abs, rules) : checkWrite(abs, run);
	});
}
