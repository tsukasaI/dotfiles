// Not an ES module: render.ts inlines this file into a classic <script>, where
// `export` is a syntax error. render.test.ts loads it through new Function.

// answers[i] is { choice: 0-3 } or { other: string }; a missing entry counts as wrong.
// Other drops out of `scored` into `gaps`: "no option fits" is not a wrong answer.
function scoreQuiz(quiz, answers) {
  const wrong = [];
  const gaps = [];
  let correct = 0;
  let scored = 0;
  quiz.forEach((q, i) => {
    const a = answers[i];
    if (a && typeof a.other === "string") {
      gaps.push(i);
      return;
    }
    scored++;
    if (a && a.choice === q.answer) correct++;
    else wrong.push(i);
  });
  return { correct, scored, wrong, gaps };
}
