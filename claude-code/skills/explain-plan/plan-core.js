// Not an ES module: plan.ts inlines this file into a classic <script>, where
// `export` is a syntax error. plan.test.ts loads it through new Function.

const RESULT_HEADER = "explain-plan-result v1";
const MAX_RESULT_TEXT = 300;

function passThreshold(scored) {
  return Math.ceil((2 * scored) / 3);
}

// answers[i] is { choice: 0-3 } or { other: string }; a missing entry counts as wrong.
function gateQuiz(quiz, answers) {
  const deep = { correct: 0, total: 0, gaps: 0 };
  const rest = { correct: 0, scored: 0, threshold: 0 };
  const wrong = [];
  const gaps = [];
  quiz.forEach((q, i) => {
    const a = answers[i];
    const isDeep = q.perspective === "deepDive";
    if (isDeep) deep.total++;
    if (a && typeof a.other === "string") {
      gaps.push(i);
      if (isDeep) deep.gaps++;
      return;
    }
    const ok = !!a && a.choice === q.answer;
    if (!ok) wrong.push(i);
    if (isDeep) {
      if (ok) deep.correct++;
    } else {
      rest.scored++;
      if (ok) rest.correct++;
    }
  });
  rest.threshold = passThreshold(rest.scored);
  // A deep-dive question answered under Other is a design gap, so it fails
  // rather than dropping out of scoring like the other perspectives do.
  const deepPassed = deep.gaps === 0 && deep.correct === deep.total;
  const restPassed = rest.scored > 0 && rest.correct >= rest.threshold;
  return { deep, rest, wrong, gaps, passed: deepPassed && restPassed };
}

// One line, capped: a pasted newline must not be able to forge a header line.
function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, MAX_RESULT_TEXT);
}

function resultBlock(slug, quiz, answers, score, difficulty) {
  const lines = [
    `${RESULT_HEADER} slug=${slug}`,
    `判定: ${score.passed ? "合格" : "不合格"}`,
    `深掘り: ${score.deep.correct}/${score.deep.total}  その他: ${score.rest.correct}/${score.rest.scored}（基準 ${score.rest.threshold}）`,
    `難易度: ${difficulty || "未回答"}`,
  ];
  for (const i of score.wrong) lines.push(`誤答: Q${i + 1} ${oneLine(quiz[i].question)}`);
  for (const i of score.gaps) {
    lines.push(`指摘: Q${i + 1} ${oneLine(quiz[i].question)} / ${oneLine(answers[i].other)}`);
  }
  return lines.join("\n");
}
