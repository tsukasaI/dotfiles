{
  description = "Ino's nix-darwin configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs }:
  let
    configuration = { pkgs, ... }: {
      environment.systemPackages = with pkgs; [
        # CLI tools
        bat
        eza
        fd
        ripgrep
        jq
        zoxide
        procs
        starship
        chafa
        gawk
        gnupg

        # Development
        neovim
        git

        # Others
        yt-dlp
        graphviz
      ];

      # Homebrew（Nixで管理できないもの用）
      homebrew = {
        enable = true;
        onActivation = {
          autoUpdate = false;
          cleanup = "zap";
        };


        # Nixに移行しないformulae
        brews = [
          "mise"
          # libompはNixだと設定が面倒なので残す
          "libomp"
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
