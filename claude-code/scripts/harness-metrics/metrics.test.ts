import { describe, expect, test } from "bun:test";
import {
  aggregate,
  analyzeSession,
  classifySubject,
  countFeatFix,
  countGuardCommits,
  countOverdue,
  hasIssueRef,
  inWindow,
  lastDayOfMonth,
  monthWindow,
  parseRateLimitLines,
  parseReviewDate,
  quotaClustering,
  renderLocal,
  renderPublic,
  topDenied,
  type ReportInput,
} from "./metrics";

const j = (o: unknown): string => JSON.stringify(o);
const user = (content: unknown, extra: Record<string, unknown> = {}): string =>
  j({ type: "user", timestamp: "2026-11-02T01:00:00Z", cwd: "/w/x", message: { content }, ...extra });
const assistantText = (text: string): string =>
  j({ type: "assistant", message: { content: [{ type: "text", text }] } });
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): string =>
  j({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string, content: string, isError = false): string =>
  j({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });

describe("human prompts", () => {
  test("excludes tool results, meta, and system-injected text", () => {
    const m = analyzeSession([
      user("hello"),
      toolResult("t1", "ok"),
      user("meta text", { isMeta: true }),
      user("<task-notification>x</task-notification>"),
      user("<system-reminder>x</system-reminder>"),
      user("<command-name>/foo</command-name>"),
      user("<local-command-stdout>x</local-command-stdout>"),
      user([{ type: "text", text: "second" }]),
    ]);
    expect(m.humanPrompts).toBe(2);
    expect(m.firstPrompt).toBe("hello");
  });
});

describe("hand-off vs self-run", () => {
  test("command in a fenced block of the preceding assistant text is a hand-off", () => {
    const m = analyzeSession([
      assistantText("Run this:\n```bash\ngit   push\n  origin main\n```"),
      user("<bash-input>git push origin main</bash-input>"),
    ]);
    expect(m.handoffs).toBe(1);
    expect(m.selfRuns).toBe(0);
    expect(m.humanPrompts).toBe(0);
  });

  test("a short command is not matched by a longer command in a block", () => {
    const m = analyzeSession([
      assistantText("```bash\nls -la foo\n```"),
      user("<bash-input>ls</bash-input>"),
    ]);
    expect(m.handoffs).toBe(0);
    expect(m.selfRuns).toBe(1);
  });

  test("an exact block or a matching multi-line block is a hand-off", () => {
    const one = analyzeSession([
      assistantText("```\nls\n```"),
      user("<bash-input>ls</bash-input>"),
    ]);
    expect(one.handoffs).toBe(1);
    const two = analyzeSession([
      assistantText("```bash\ncd x\ngit status\n```"),
      user("<bash-input>cd x\ngit status</bash-input>"),
    ]);
    expect(two.handoffs).toBe(1);
  });

  test("a command not offered by the assistant is self-run", () => {
    const m = analyzeSession([
      assistantText("Nothing fenced here, git push origin main"),
      user("<bash-input>git push origin main</bash-input>"),
    ]);
    expect(m.handoffs).toBe(0);
    expect(m.selfRuns).toBe(1);
  });
});

describe("hook denials", () => {
  test("a denial without a command is recorded as the tool name", () => {
    const m = analyzeSession([
      toolUse("t1", "Edit", { file_path: "/x" }),
      toolResult("t1", "PreToolUse:Edit hook error: blocked", true),
    ]);
    expect(m.deniedCommands).toEqual(["[Edit]"]);
  });

  test("pairs the denial with the tool_use command", () => {
    const m = analyzeSession([
      toolUse("t1", "Bash", { command: "rm -rf x" }),
      toolResult("t1", "PreToolUse:Bash hook error: blocked", true),
      toolUse("t2", "Bash", { command: "ls" }),
      toolResult("t2", "file"),
    ]);
    expect(m.deniedCommands).toEqual(["rm -rf x"]);
    const t = aggregate([{ sessionId: "s", metrics: m }]);
    expect(t.denials).toBe(1);
    expect(t.denialSessions).toBe(1);
    expect(topDenied([{ sessionId: "s", metrics: m }], 10)).toEqual([{ command: "rm -rf x", count: 1 }]);
  });
});

describe("autonomous completion", () => {
  const plan = [toolUse("p", "ExitPlanMode"), toolResult("p", "approved")];
  const merge = [
    toolUse("m", "Bash", { command: "gh pr merge 1 --squash" }),
    toolResult("m", "merged"),
  ];

  test("accepted plan then successful merge with no prompt between", () => {
    expect(analyzeSession([user("go"), ...plan, ...merge]).autonomous).toBe(true);
  });

  test("a human prompt between acceptance and merge disqualifies", () => {
    expect(analyzeSession([user("go"), ...plan, user("wait, also X"), ...merge]).autonomous).toBe(false);
  });

  test("a rejected plan does not count", () => {
    const rejected = [toolUse("p", "ExitPlanMode"), toolResult("p", "no", true)];
    expect(analyzeSession([user("go"), ...rejected, ...merge]).autonomous).toBe(false);
  });

  describe("direct push to main", () => {
    const push = [
      toolUse("g", "Bash", { command: "git push origin main" }),
      toolResult("g", "pushed"),
    ];

    test("accepted plan then push in dotfiles counts", () => {
      const m = analyzeSession([user("go", { cwd: "/Users/me/dotfiles" }), ...plan, ...push]);
      expect(m.autonomous).toBe(true);
      expect(m.planAccepted).toBe(true);
    });

    test("the same push in a branch+PR repo does not", () => {
      const m = analyzeSession([user("go", { cwd: "/Users/me/app" }), ...plan, ...push]);
      expect(m.autonomous).toBe(false);
      expect(m.planAccepted).toBe(true);
    });

    const bash = (id: string, command: string): string[] => [
      toolUse(id, "Bash", { command }),
      toolResult(id, "ok"),
    ];
    const inDotfiles = user("go", { cwd: "/Users/me/dotfiles" });

    test("push text inside a commit message is not a push", () => {
      const m = analyzeSession([
        inDotfiles,
        ...plan,
        ...bash("c", 'git commit -m "feat: x; git push later"'),
        user("also Y"),
        ...push,
      ]);
      expect(m.autonomous).toBe(false);
    });

    test("a dry-run push does not count", () => {
      expect(
        analyzeSession([inDotfiles, ...plan, ...bash("d", "git push --dry-run origin main")]).autonomous,
      ).toBe(false);
      expect(analyzeSession([inDotfiles, ...plan, ...bash("d", "git push -n origin main")]).autonomous).toBe(
        false,
      );
    });

    test("a push chained after another command counts", () => {
      expect(
        analyzeSession([inDotfiles, ...plan, ...bash("e", "git add . && git push origin main")]).autonomous,
      ).toBe(true);
    });

    test("echoing a merge command is not a merge", () => {
      expect(analyzeSession([user("go"), ...plan, ...bash("f", "echo gh pr merge 1")]).autonomous).toBe(false);
    });

    test("a handoff between acceptance and push disqualifies without counting as a prompt", () => {
      const m = analyzeSession([
        user("go", { cwd: "/Users/me/dotfiles" }),
        ...plan,
        assistantText("Run this:\n```bash\ngit status\n```"),
        user("<bash-input>git status</bash-input>"),
        ...push,
      ]);
      expect(m.handoffs).toBe(1);
      expect(m.humanPrompts).toBe(1);
      expect(m.autonomous).toBe(false);
      expect(m.planAccepted).toBe(true);
    });

    test("a self-run ! command that is not a handoff keeps autonomous", () => {
      const m = analyzeSession([
        user("go", { cwd: "/Users/me/dotfiles" }),
        ...plan,
        user("<bash-input>ls</bash-input>"),
        ...push,
      ]);
      expect(m.selfRuns).toBe(1);
      expect(m.autonomous).toBe(true);
    });

    test("a human prompt between acceptance and push disqualifies but keeps planAccepted", () => {
      const m = analyzeSession([
        user("go", { cwd: "/Users/me/dotfiles" }),
        ...plan,
        user("wait, also X"),
        ...push,
      ]);
      expect(m.autonomous).toBe(false);
      expect(m.planAccepted).toBe(true);
    });
  });

  test("planSessions counts sessions with an accepted plan", () => {
    const withPlan = analyzeSession([user("go"), ...plan]);
    const without = analyzeSession([user("go")]);
    const t = aggregate([
      { sessionId: "a", metrics: withPlan },
      { sessionId: "b", metrics: without },
    ]);
    expect(t.planSessions).toBe(1);
  });

  test("counts canary tool uses and abnormal stops", () => {
    const m = analyzeSession([
      toolUse("a", "AskUserQuestion"),
      ...plan,
      j({ type: "assistant", isApiErrorMessage: true, message: { content: [] } }),
    ]);
    expect(m.askUserQuestions).toBe(1);
    expect(m.exitPlanModes).toBe(1);
    expect(m.abnormalStops).toBe(1);
  });
});

describe("robustness", () => {
  test("skips malformed and non-object lines", () => {
    const m = analyzeSession(["not json", "null", "42", '"s"', "[1]", "{", user("real")]);
    expect(m.humanPrompts).toBe(1);
  });
});

describe("git helpers", () => {
  test("classifies subjects", () => {
    expect(classifySubject("feat(x): a")).toBe("feat");
    expect(classifySubject("fix: b")).toBe("fix");
    expect(classifySubject("feat!: c")).toBe("feat");
    expect(classifySubject("chore: d")).toBe("other");
    expect(countFeatFix(["feat: a", "fix: b", "fix(x): c", "docs: d"])).toEqual({ feat: 1, fix: 2 });
  });

  test("detects issue refs and guard commits without one", () => {
    const strip = { stripPrSuffix: true };
    expect(hasIssueRef("fix: a #12", strip)).toBe(true);
    expect(hasIssueRef("fix: a", strip)).toBe(false);
    expect(hasIssueRef("fix(x): y (#12)", strip)).toBe(false);
    expect(hasIssueRef("fix(x): y (#12)", { stripPrSuffix: false })).toBe(true);
    expect(hasIssueRef("fix(x): y\n\nrefs #5 (#12)", strip)).toBe(true);
    expect(
      countGuardCommits([
        { repo: "dotfiles", message: "a #1" },
        { repo: "shguard", message: "b" },
      ]),
    ).toEqual({ total: 2, withoutIssueRef: 1, unreferenced: [{ repo: "shguard", subject: "b" }] });
  });

  test("a trailing (#N) is an issue ref in dotfiles but a PR suffix in shguard", () => {
    const stats = countGuardCommits([
      { repo: "dotfiles", message: "fix(x): y (#133)" },
      { repo: "shguard", message: "fix(x): y (#133)" },
    ]);
    expect(stats.unreferenced).toEqual([{ repo: "shguard", subject: "fix(x): y (#133)" }]);
  });

  test("lists unreferenced guard commits by repo and subject", () => {
    const stats = countGuardCommits([
      { repo: "dotfiles", message: "fix(hooks): tighten rule\n\nbody without ref\n" },
      { repo: "dotfiles", message: "feat(shguard): add row\n\nrefs #12" },
      { repo: "shguard", message: "  chore: bump (#34)  \n" },
    ]);
    expect(stats.total).toBe(3);
    expect(stats.unreferenced).toEqual([
      { repo: "dotfiles", subject: "fix(hooks): tighten rule" },
      { repo: "shguard", subject: "chore: bump (#34)" },
    ]);
  });

  test("parses review dates and counts overdue", () => {
    expect(parseReviewDate("hypothesis\nreview: 2026-12-01\n")).toBe("2026-12-01");
    expect(parseReviewDate("no date")).toBeUndefined();
    expect(countOverdue(["review: 2026-10-01", "review: 2026-12-01", "x"], "2026-11-15")).toBe(1);
  });
});

describe("month window", () => {
  test("defaults to the previous month in JST", () => {
    const r = monthWindow(undefined, new Date("2026-11-15T00:00:00Z"));
    expect(r.ok && r.value.month).toBe("2026-10");
    const jan = monthWindow(undefined, new Date("2026-01-31T16:00:00Z"));
    expect(jan.ok && jan.value.month).toBe("2026-01");
    const jan2 = monthWindow(undefined, new Date("2026-01-10T00:00:00Z"));
    expect(jan2.ok && jan2.value.month).toBe("2025-12");
  });

  test("last day of month is inclusive-range safe, including December", () => {
    const nov = monthWindow("2026-11", new Date());
    const dec = monthWindow("2026-12", new Date());
    const feb = monthWindow("2028-02", new Date());
    if (!nov.ok || !dec.ok || !feb.ok) throw new Error("expected ok");
    expect(lastDayOfMonth(nov.value)).toBe("2026-11-30");
    expect(lastDayOfMonth(dec.value)).toBe("2026-12-31");
    expect(lastDayOfMonth(feb.value)).toBe("2028-02-29");
  });

  test("rejects a malformed month and uses JST boundaries", () => {
    expect(monthWindow("2026-13", new Date()).ok).toBe(false);
    expect(monthWindow("nope", new Date()).ok).toBe(false);
    const r = monthWindow("2026-11", new Date());
    if (!r.ok) throw new Error("expected ok");
    expect(inWindow("2026-10-31T15:00:00Z", r.value)).toBe(true);
    expect(inWindow("2026-10-31T14:59:59Z", r.value)).toBe(false);
    expect(inWindow("2026-11-30T15:00:00Z", r.value)).toBe(false);
  });
});

describe("rate limits", () => {
  const w = monthWindow("2026-11", new Date());
  if (!w.ok) throw new Error("window");
  const win = w.value;
  const at = (hours: number) => win.startMs + hours * 3_600_000;
  const snap = (hours: number, pct: number) => ({ tsMs: at(hours), sevenDayPct: pct });
  const spanHours = (win.endMs - win.startMs) / 3_600_000;

  test("parser skips empty, malformed and incomplete lines", () => {
    const line = (o: unknown) => JSON.stringify(o);
    const out = parseRateLimitLines([
      "",
      "not json",
      "null",
      line({ ts: "2026-11-02T00:00:00Z" }),
      line({ seven_day_pct: 10 }),
      line({ ts: "bad", seven_day_pct: 10 }),
      line({ ts: "2026-11-03T00:00:00Z", seven_day_pct: "10" }),
      line({ ts: "2026-11-03T00:00:00Z", seven_day_pct: 20, five_hour_pct: null }),
      line({ ts: "2026-11-02T00:00:00Z", seven_day_pct: 10 }),
    ]);
    expect(out.map((s) => s.sevenDayPct)).toEqual([10, 20]);
    expect(parseRateLimitLines([])).toEqual([]);
  });

  test("a commit before any snapshot is not judged", () => {
    const r = quotaClustering([at(1)], [snap(2, 10)], 30, win);
    expect(r.judged).toBe(0);
    expect(r.highRemaining).toBe(0);
  });

  test("judges against the snapshot at or before the commit; threshold is inclusive", () => {
    const snaps = [snap(1, 30), snap(10, 31)];
    const r = quotaClustering([at(1), at(5), at(10), at(20)], snaps, 30, win);
    expect(r.judged).toBe(4);
    expect(r.highRemaining).toBe(2);
  });

  test("time share runs each snapshot to the next one or the window end", () => {
    const r = quotaClustering([], [snap(0, 10), snap(10, 90)], 30, win);
    expect(r.highTimeShare).toBeCloseTo(10 / spanHours, 10);
  });

  test("snapshots outside the window are ignored and no data gives null", () => {
    const outside = [{ tsMs: win.startMs - 1, sevenDayPct: 0 }, { tsMs: win.endMs, sevenDayPct: 0 }];
    const r = quotaClustering([at(1)], outside, 30, win);
    expect(r).toEqual({ judged: 0, highRemaining: 0, highTimeShare: null });
  });

  test("public line is numbers only, and falls back when there is no data", () => {
    const base: ReportInput = {
      window: win,
      totals: aggregate([]),
      repos: [],
      excludedRepos: [],
      guard: null,
      urgentIssues: null,
      overdueHypotheses: null,
      warnings: [],
      topDenied: [],
      sample: [],
    };
    const some = renderPublic({ ...base, quota: { judged: 4, highRemaining: 3, highTimeShare: 0.25 } });
    expect(some).toContain("目的化の見張り: 残量が多い時期のハーネス系コミット 3/4（基準: 残量が多い時間の割合 25.0%）");
    expect(renderPublic({ ...base, quota: null })).toContain("未計測（rate_limits 未記録）");
    expect(renderPublic({ ...base, quota: { judged: 0, highRemaining: 0, highTimeShare: null } })).toContain(
      "未計測（rate_limits 未記録）",
    );
  });
});

describe("rendering", () => {
  const w = monthWindow("2026-11", new Date());
  if (!w.ok) throw new Error("window");
  const metrics = analyzeSession([user("secret-prompt-text"), toolUse("t", "Bash", { command: "secret-cmd" }), toolResult("t", "PreToolUse: hook error")]);
  const records = [{ sessionId: "sid1", metrics }];
  const input: ReportInput = {
    window: w.value,
    totals: aggregate(records),
    repos: [{ repo: "secret-repo", kind: "product", feat: 3, fix: 1, mergedPrs: null }],
    excludedRepos: ["private-playground"],
    guard: { total: 2, withoutIssueRef: 1, unreferenced: [{ repo: "shguard", subject: "fix: secret-subject" }] },
    urgentIssues: null,
    overdueHypotheses: 0,
    warnings: ["gh failed in secret-repo"],
    topDenied: topDenied(records, 10),
    sample: [{ sessionId: "sid1", project: "secret-repo", firstPrompt: "secret-prompt-text" }],
  };

  test("public section holds aggregates only", () => {
    const pub = renderPublic(input);
    for (const s of ["secret-repo", "secret-prompt-text", "secret-cmd", "private-playground", "secret-subject"]) {
      expect(pub).not.toContain(s);
    }
    expect(pub).not.toContain("手戻り率");
    expect(pub).toContain("harness-urgent Issue: N/A");
  });

  test("harness commits do not affect the product shipping line", () => {
    const withHarness: ReportInput = {
      ...input,
      repos: [...input.repos, { repo: "dotfiles", kind: "harness", feat: 10, fix: 30, mergedPrs: null }],
    };
    const pub = renderPublic(withHarness);
    expect(pub).toContain("出荷（プロダクト系）: feat 3 / fix 1");
    expect(pub).toContain("ハーネス系: feat 10 / fix 30");
    expect(pub).not.toContain("dotfiles");
  });

  test("local section carries the details", () => {
    const local = renderLocal(input);
    for (const s of ["secret-repo", "secret-prompt-text", "secret-cmd"]) {
      expect(local).toContain(s);
    }
    expect(local).toContain("### Issue 参照のないガードファイルのコミット\n- shguard: fix: secret-subject");
  });

  test("local guard section handles empty and unavailable data", () => {
    const empty = renderLocal({ ...input, guard: { total: 1, withoutIssueRef: 0, unreferenced: [] } });
    expect(empty).toContain("### Issue 参照のないガードファイルのコミット\n- なし");
    expect(renderLocal({ ...input, guard: null })).toContain(
      "### Issue 参照のないガードファイルのコミット\n- N/A",
    );
  });

  test("public autonomous line shows the plan-accepted denominator", () => {
    expect(renderPublic(input)).toContain("自律稼働セッション: 0（計画承認 0 セッション中）");
  });
});
