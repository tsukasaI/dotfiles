{ git, opsDir, python3, writeShellApplication }:
writeShellApplication {
  name = "career-consistency";
  runtimeInputs = [ git ];
  # Not a store copy: its tests carry career facts, and a flake input of ops
  # would put career/ in the world-readable store. The path is write-protected
  # by block-config-edit.sh and sandbox denyWrite instead.
  text = ''exec ${python3}/bin/python3 -I ${opsDir}/scripts/check_career_consistency.py "$@"'';
}
