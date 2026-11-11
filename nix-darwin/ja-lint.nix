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
  # Not the file operand as-is: yomiyasu 3.x refuses files outside the cwd or
  # under a dot directory (scratchpad drafts, .claude/rules/*.md), so the file
  # goes in on stdin. shguard's dotfiles-secret-read-ja-lint rule is the
  # boundary on the Mac instead.
  text = ''
    lint=(${python3}/bin/python3 -I ${scripts}/yomiyasu_lint.py)
    args=()
    file=""
    have_file=0
    take_file() {
      if [ "$have_file" -eq 1 ]; then
        echo "ja-lint: only one file can be linted at a time" >&2
        exit 2
      fi
      file="$1"
      have_file=1
    }
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --doc-type | --reader | --words | --fail-on)
          args+=("$1")
          shift
          if [ "$#" -gt 0 ]; then
            args+=("$1")
            shift
          fi
          ;;
        --)
          shift
          for operand in "$@"; do take_file "$operand"; done
          break
          ;;
        -?*)
          args+=("$1")
          shift
          ;;
        *)
          take_file "$1"
          shift
          ;;
      esac
    done
    if [ "$have_file" -eq 0 ] || [ "$file" = "-" ]; then
      exec "''${lint[@]}" "''${args[@]}" -
    fi
    if [ ! -f "$file" ] || [ ! -r "$file" ]; then
      echo "ja-lint: cannot read file: $file" >&2
      exit 2
    fi
    exec "''${lint[@]}" "''${args[@]}" - <"$file"
  '';
}
