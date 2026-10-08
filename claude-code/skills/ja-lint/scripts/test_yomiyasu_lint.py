"""Regression tests for the vendored yomiyasu_lint.py's fence handling (issue #76).

Run: python3 -I claude-code/skills/ja-lint/scripts/test_yomiyasu_lint.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import yomiyasu_lint as y  # noqa: E402

# Content that trips several rules when it appears in body text.
TRIGGER = "結論から言うと、動きます。\nAではなくBを使う。\n解像度を上げる。\n絵文字です🚀。\n"
TRIGGER_RULES = {
    "emoji_prohibited",
    "slop_vocabulary",
    "meta_filler",
    "negative_parallelism",
}


def fenced(marker: str) -> str:
    return f"本文です。\n{marker}\n{TRIGGER}{marker}\n"


def rules(text: str) -> set:
    return {f["rule"] for f in y.lint_text(text)["findings"]}


class FenceTests(unittest.TestCase):
    def test_trigger_is_detected_outside_fence(self):
        self.assertTrue(TRIGGER_RULES <= rules("本文です。\n" + TRIGGER))

    def test_backtick_fence_ignored(self):
        self.assertEqual(rules(fenced("```")), set())

    def test_tilde_fence_ignored_by_all_rules(self):
        self.assertEqual(rules(fenced("~~~")), set())

    def test_tilde_fence_ignored_by_metrics_and_sentences(self):
        body = "~~~\n- 項目\n- 項目\n**太字** **太字**\n今日は晴れだ。明日は雨だ。明後日は曇りだ。\n~~~\n"
        m = y.analyze_markdown_metrics(body)
        self.assertEqual(m["char_count"], 0)
        self.assertEqual(m["list_lines"], 0)
        self.assertEqual(m["bold_count"], 0)
        self.assertEqual(y.extract_plain_sentences(body), [])

    def test_backtick_fence_with_info_string(self):
        self.assertEqual(rules("```python\n" + TRIGGER + "```\n"), set())

    def test_fence_closes_and_following_text_is_linted(self):
        text = fenced("~~~") + TRIGGER
        self.assertTrue(TRIGGER_RULES <= rules(text))

    def test_other_marker_inside_fence_does_not_close_it(self):
        self.assertEqual(rules("```\n~~~\n" + TRIGGER + "```\n"), set())
        self.assertEqual(rules("~~~\n```\n" + TRIGGER + "~~~\n"), set())

    def test_frontmatter_skipped(self):
        self.assertEqual(rules("---\ntitle: " + TRIGGER + "---\n"), set())


class SentenceEndingTests(unittest.TestCase):
    def test_three_in_a_row_flagged(self):
        text = "今日は晴れだ。明日は雨だ。明後日は曇りだ。\n"
        self.assertIn("sentence_end_repetition", rules(text))


if __name__ == "__main__":
    unittest.main()
