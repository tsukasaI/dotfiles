{ lib, stdenvNoCC, bun }:
stdenvNoCC.mkDerivation {
  pname = "diagram-render";
  version = "0";
  src = lib.fileset.toSource {
    root = ../claude-code/skills/diagram-explain;
    fileset = lib.fileset.unions [
      ../claude-code/skills/diagram-explain/render.ts
      ../claude-code/skills/diagram-explain/template.html
      ../claude-code/skills/diagram-explain/quiz-core.js
    ];
  };
  nativeBuildInputs = [ bun ];
  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
      --outfile diagram-render render.ts
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 diagram-render $out/bin/diagram-render
    runHook postInstall
  '';
  # Not stripped: strip drops the script bun appends to its own executable.
  dontStrip = true;
  meta.mainProgram = "diagram-render";
}
