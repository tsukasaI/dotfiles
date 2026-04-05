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
    configuration = { pkgs, lib, ... }:
    let
      treesitterParsers = pkgs.vimPlugins.nvim-treesitter.withPlugins (p: with p; [
        rust toml go gomod gowork gosum
      ]);
      neovimWithParsers = pkgs.symlinkJoin {
        name = "neovim-with-parsers";
        paths = [ pkgs.neovim ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram $out/bin/nvim \
            --add-flags '--cmd "set rtp^=${treesitterParsers}"'
        '';
      };
    in
    {
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
        neovimWithParsers
        git
        llvmPackages.openmp

        # DevOps / CLI tools
        awscli2
        gh
        biome
        lefthook
        terraform

        # Language runtimes
        bun
        go
        gopls
        gofumpt
        gotools # goimports etc.
        nodejs
        pnpm
        rustup
        uv
        # Others
        charm-freeze
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
          "wezterm"
          "raycast"
          "orbstack"
          "karabiner-elements"
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
