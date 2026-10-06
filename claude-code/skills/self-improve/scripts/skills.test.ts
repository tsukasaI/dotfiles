import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SKILLS_TS = join(import.meta.dir, "skills.ts");
const CORRECTIONS_TS = join(import.meta.dir, "corrections.ts");

let scratch: string;
let home: string;
let cwd: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "self-improve-test-"));
  home = join(scratch, "home");
  cwd = join(scratch, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeSkill(skillsDir: string, name: string) {
  mkdirSync(join(skillsDir, name), { recursive: true });
  writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\nbody of ${name}\n`);
}

// SKILL.md as a directory makes existsSync() true and readFileSync() throw EISDIR.
function writeBadSkill(skillsDir: string, name: string) {
  mkdirSync(join(skillsDir, name, "SKILL.md"), { recursive: true });
}

function runSkills(env: Record<string, string | undefined>) {
  const proc = Bun.spawnSync([process.execPath, SKILLS_TS], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function parse(stdout: string) {
  return JSON.parse(stdout) as {
    meta: { errors: string[] };
    available_skills: { name: string; path: string }[];
  };
}

describe("skills.ts skill loading", () => {
  const env = () => ({ HOME: home, CLAUDE_LOGS_DB: join(scratch, "missing.db") });

  test("unreadable user SKILL.md does not crash and is reported in meta.errors", () => {
    const userSkills = join(home, ".claude", "skills");
    writeSkill(userSkills, "good");
    writeBadSkill(userSkills, "bad");

    const r = runSkills(env());
    const out = parse(r.stdout);

    expect(out.available_skills.map((s) => s.name)).toContain("good");
    expect(out.available_skills.map((s) => s.name)).not.toContain("bad");
    expect(out.meta.errors.some((e) => e.includes(join(userSkills, "bad", "SKILL.md")))).toBe(true);
  });

  test("one bad project skill does not drop its siblings", () => {
    const projSkills = join(cwd, ".claude", "skills");
    writeBadSkill(projSkills, "aaa-bad");
    writeSkill(projSkills, "zzz-good");
    writeSkill(projSkills, "mmm-good");

    const r = runSkills(env());
    const out = parse(r.stdout);

    const names = out.available_skills.map((s) => s.name);
    expect(names).toContain("zzz-good");
    expect(names).toContain("mmm-good");
    expect(out.meta.errors.some((e) => e.includes(join(projSkills, "aaa-bad", "SKILL.md")))).toBe(true);
  });

  test("a skills dir that is not a directory is reported, not fatal", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills"), "not a directory");

    const r = runSkills(env());
    const out = parse(r.stdout);

    expect(out.meta.errors.some((e) => e.includes(join(home, ".claude", "skills")))).toBe(true);
  });
});

describe("skills.ts frontmatter parsing", () => {
  const env = () => ({ HOME: home, CLAUDE_LOGS_DB: join(scratch, "missing.db") });

  function writeRaw(name: string, frontmatter: string) {
    const dir = join(home, ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nbody\n`);
  }

  function descriptions(): Record<string, string> {
    const r = runSkills(env());
    const out = JSON.parse(r.stdout) as { available_skills: { name: string; description: string }[] };
    return Object.fromEntries(out.available_skills.map((s) => [s.name, s.description]));
  }

  test("plain, literal (|, |-) and folded (>) scalars, and keys after a block scalar", () => {
    writeRaw("plain", "name: plain\ndescription: one line");
    writeRaw("literal", "name: literal\ndescription: |\n  first\n    indented\n\n  last\nother: x");
    writeRaw("literal-strip", "name: literal-strip\ndescription: |-\n  a\n  b\n\n");
    writeRaw("folded", "name: folded\ndescription: >\n  one\n  two\n\n  three\nafter: y");
    writeRaw("empty-scalar", "name: empty-scalar\ndescription: >\nnext: z");

    const d = descriptions();
    expect(d["plain"]).toBe("one line");
    expect(d["literal"]).toBe("first\n  indented\n\nlast");
    expect(d["literal-strip"]).toBe("a\nb");
    expect(d["folded"]).toBe("one two\n\nthree");
    expect(d["empty-scalar"]).toBe("");
  });

  test("a key following a block scalar is still parsed as the name", () => {
    writeRaw("dirname", "description: |\n  text\nname: renamed");
    const d = descriptions();
    expect(d["renamed"]).toBe("text");
  });
});

describe("HOME check", () => {
  for (const script of [SKILLS_TS, CORRECTIONS_TS]) {
    test(`${script.split("/").pop()} without HOME exits 2 with a message that says HOME is required`, () => {
      const proc = Bun.spawnSync([process.execPath, script], {
        cwd,
        env: { PATH: process.env.PATH, CLAUDE_LOGS_DB: join(scratch, "x.db") },
      });
      expect(proc.exitCode).toBe(2);
      const msg = proc.stderr.toString();
      expect(msg).toContain("HOME is not set");
      expect(msg).toContain("Set HOME;");
      expect(msg).not.toContain("Set HOME or CLAUDE_LOGS_DB");
    });
  }
});
