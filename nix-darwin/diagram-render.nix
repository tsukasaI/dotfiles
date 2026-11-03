{ lib, stdenvNoCC, bun }:
stdenvNoCC.mkDerivation {
  pname = "diagram-render";
  version = "0";
  src = lib.fileset.toSource {
    root = ../claude-code/skills;
    fileset = lib.fileset.unions [
      ../claude-code/skills/diagram-explain/render.ts
      ../claude-code/skills/diagram-explain/template.html
      ../claude-code/skills/diagram-explain/quiz-core.js
      ../claude-code/skills/explain-plan/plan.ts
      ../claude-code/skills/explain-plan/plan-core.js
    ];
  };
  nativeBuildInputs = [ bun ];
  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    for entry in diagram-explain/render.ts:diagram-render explain-plan/plan.ts:explain-plan-render; do
      bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
        --outfile "''${entry#*:}" "''${entry%%:*}"
    done
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 -t $out/bin diagram-render explain-plan-render
    runHook postInstall
  '';
  # Not stripped: strip drops the script bun appends to its own executable.
  dontStrip = true;
  meta.mainProgram = "diagram-render";
}
