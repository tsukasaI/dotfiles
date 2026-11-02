# The shguard hook binary, built from the `shguard` flake input's source.
# shguard's own flake has no `packages.default` yet (tsukasaI/shguard#1114);
# once it does, use that instead and delete this file. Built like shguard's
# release job (`cargo build --locked --release -p shguard`), with nixpkgs'
# stable rustc. No checkPhase: the differential tests need bash, brush and
# shfmt, and the release job runs `cargo test` before it publishes.
{ lib, rustPlatform, src }:
rustPlatform.buildRustPackage {
  pname = "shguard";
  version = (builtins.fromTOML (builtins.readFile "${src}/Cargo.toml")).workspace.package.version;
  inherit src;
  cargoLock.lockFile = "${src}/Cargo.lock";
  cargoBuildFlags = [ "-p" "shguard" ];
  doCheck = false;
  meta = {
    description = "PreToolUse hook gating shell commands through a Creusot-verified kernel";
    license = with lib.licenses; [ mit asl20 ];
    mainProgram = "shguard";
  };
}
