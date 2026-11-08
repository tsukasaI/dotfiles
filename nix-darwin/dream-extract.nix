{ bash, coreutils, fd, jq, lib, opsDir, primaryUser, writeShellApplication }:
let
  driver = lib.fileset.toSource {
    root = ./dream-extract;
    fileset = lib.fileset.unions [
      ./dream-extract/dream-extract.sh
      ./dream-extract/owner-text.jq
    ];
  };
in
writeShellApplication {
  name = "dream-extract";
  # Not the caller's environment: a BASH_ENV or exported function there would
  # run inside the driver.
  text = ''
    exec ${coreutils}/bin/env -i \
      PATH=${lib.makeBinPath [ coreutils fd jq ]} \
      DREAM_LOG_DIR=/Users/${primaryUser}/.claude/projects/${builtins.replaceStrings [ "/" ] [ "-" ] opsDir} \
      DREAM_OUT_DIR=${opsDir}/.claude/tmp-dream-backup/owner-text \
      DREAM_FILTER=${driver}/owner-text.jq \
      ${bash}/bin/bash ${driver}/dream-extract.sh "$@"
  '';
}
