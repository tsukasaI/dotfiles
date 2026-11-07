{ lib, python3, writeShellApplication }:
let
  scripts = lib.fileset.toSource {
    root = ../claude-code/skills/ja-lint/scripts;
    fileset = lib.fileset.unions [
      ../claude-code/skills/ja-lint/scripts/yomiyasu_lint.py
      ../claude-code/skills/ja-lint/scripts/markdown_visibility.py
    ];
  };
in
writeShellApplication {
  name = "ja-lint";
  text = ''exec ${python3}/bin/python3 -I ${scripts}/yomiyasu_lint.py "$@"'';
}
