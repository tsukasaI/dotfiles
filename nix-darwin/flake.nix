{
  description = "Ino's nix-darwin configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    ewc.url = "github:tsukasaI/ewc";
    ewc.inputs.nixpkgs.follows = "nixpkgs";
    fini.url = "github:tsukasaI/fini";
    fini.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs, ewc, fini }:
  let
    system = "aarch64-darwin";
    configuration = { pkgs, lib, ... }: {
      environment.systemPackages = [
        ewc.packages.${system}.default
        fini.packages.${system}.default
      ] ++ (with pkgs; [
        # CLI tools
        bat
        eza
        fd
        ripgrep
        jq
        zoxide
        procs

        chafa
        gawk
        gnupg

        # Development
        neovim
        git
        llvmPackages.openmp

        # DevOps / CLI tools (migrated from mise)
        awscli2
        gh
        biome
        lefthook
        terraform

        # Language runtimes (migrated from mise)
        bun
        go
        gopls
        gofumpt
        gotools # goimports etc.
        nodejs
        pnpm
        rustup
        # Others
        silicon
        graphviz
      ]);

      # Homebrew（Nixで管理できないもの用）
      homebrew = {
        enable = true;
        onActivation = {
          autoUpdate = true;
					upgrade = true;
          cleanup = "zap";
        };


        # Nixに移行しないformulae
        brews = [
          "deck"
          "mise"
          "yt-dlp"
        ];

        casks = [
          "ghostty"
          "raycast"
          "orbstack"
          "claude-code"
          "session-manager-plugin"
          "font-plemol-jp-nf"
          "font-blex-mono-nerd-font"
        ];
      };

      nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [
        "terraform"
      ];

      nix.settings.experimental-features = "nix-command flakes";
      system.primaryUser = "inouetsukasa";
      system.stateVersion = 5;
      nixpkgs.hostPlatform = "aarch64-darwin";
    };
  in
  {
    darwinConfigurations."Ino-macbook-air" = nix-darwin.lib.darwinSystem {
      modules = [ configuration ];
    };
  };
}
