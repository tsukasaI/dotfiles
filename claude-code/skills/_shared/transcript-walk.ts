// transcript-walk.ts — shared JSONL project-transcript walk for self-improve
// scripts (#9). skills.ts and corrections.ts each independently defined
// HOME/PROJECTS_DIR and a recursive walker over
// ~/.claude/projects/<encoded-cwd>/*.jsonl that applies the incremental
// (mtimeMs, size) cache from #40. This module centralizes that walk and
// cache I/O; each script still owns its own per-file extraction (what it
// pulls out of a transcript) and result aggregation shape, since those
// differ entirely between the two scripts.

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, renameSync } from "fs";
import { join } from "path";

export const HOME = Bun.env.HOME!;
export const PROJECTS_DIR = join(HOME, ".claude", "projects");

export interface CacheFile<T> {
  version: number;
  files: Record<string, T & { mtimeMs: number; size: number }>;
}

export function loadCache<T>(cachePath: string, version: number): CacheFile<T> {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (parsed && parsed.version === version && parsed.files && typeof parsed.files === "object") {
      return parsed;
    }
  } catch {
    // missing/corrupt cache — fall back to a full rescan this run
  }
  return { version, files: {} };
}

export function saveCache<T>(cachePath: string, cacheDir: string, cache: CacheFile<T>): void {
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, cachePath);
  } catch (e) {
    console.error(`warn: could not persist self-improve scan cache: ${e}`);
  }
}

// walkProjectTranscripts recurses through PROJECTS_DIR's per-project
// subdirectories, visiting every .jsonl file whose mtime is within
// `cutoffMs`. For each file it reuses `oldCache`'s entry when (mtimeMs,
// size) still match (the file hasn't changed since the last run) and
// otherwise calls `extractSession(file)`; either way the result is recorded
// into `newCache` and handed to `onSession`. Returns the running
// sessions-scanned count and the oldest session start time seen, since both
// callers track those in their own result shape.
export function walkProjectTranscripts<TExtract extends { sessionStartMs: number | null }>(
  cutoffMs: number,
  oldCache: CacheFile<TExtract>,
  newCache: CacheFile<TExtract>,
  extractSession: (file: string) => TExtract,
  onSession: (extract: TExtract) => void,
): { sessionsScanned: number; oldestSessionMs: number | null } {
  let sessionsScanned = 0;
  let oldestSessionMs: number | null = null;

  function walkDir(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walkDir(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoffMs) continue;

      const cached = oldCache.files[full];
      const extract: TExtract =
        cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size
          ? cached
          : extractSession(full);
      newCache.files[full] = { mtimeMs: st.mtimeMs, size: st.size, ...extract };

      sessionsScanned++;
      onSession(extract);
      if (extract.sessionStartMs !== null) {
        if (oldestSessionMs === null || extract.sessionStartMs < oldestSessionMs) {
          oldestSessionMs = extract.sessionStartMs;
        }
      }
    }
  }

  if (existsSync(PROJECTS_DIR)) {
    for (const projEntry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!projEntry.isDirectory()) continue;
      walkDir(join(PROJECTS_DIR, projEntry.name));
    }
  }

  return { sessionsScanned, oldestSessionMs };
}
