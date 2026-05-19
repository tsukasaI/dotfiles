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
      # Pre-compile tree-sitter parsers via Nix so nvim doesn't need a C toolchain at runtime.
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
        # Modern CLI replacements
        bat
        eza
        fd
        ripgrep
        procs
        zoxide
        fzf
        jq
        tokei

        # Required for git commit signing (gpgsign = true)
        gnupg

        # Editor / Git
        neovimWithParsers
        git
        lazygit

        # Cloud / DevOps
        awscli2
        gh
        terraform

        # Node / TypeScript
        bun
        nodejs
        pnpm

        # Go (LSP, formatters, debugger for nvim-dap-go)
        go
        gopls
        gofumpt
        gotools # goimports
        delve

        # Python
        uv
      ]);

      # Touch ID for sudo (works inside tmux/screen via pam_reattach)
      security.pam.services.sudo_local = {
        touchIdAuth = true;
        reattach = true;
      };

      # Homebrew（Nixで管理できないもの用）
      homebrew = {
        enable = true;
        onActivation = {
          autoUpdate = true;
          upgrade = true;
          cleanup = "zap";
        };

        taps = [
          "bendews/tap"  # apw (Apple Passwords CLI)
        ];

        # Nixに移行しないformulae
        brews = [
          "deck"
          "mise"
          "yt-dlp"
          "apw"  # Apple Passwords CLI
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

      system.defaults = {
        NSGlobalDomain = {
          KeyRepeat = 1;
          InitialKeyRepeat = 10;
          ApplePressAndHoldEnabled = false;

          "com.apple.trackpad.scaling" = 3.0;

          "com.apple.swipescrolldirection" = true;
        };

        ".GlobalPreferences"."com.apple.mouse.scaling" = 3.0;

        trackpad = {
          Clicking = true;
          Dragging = false;
          DragLock = false;
          TrackpadThreeFingerDrag = true;
          TrackpadRightClick = true;
          FirstClickThreshold = 2;
          SecondClickThreshold = 2;
        };

        CustomUserPreferences = {
          "com.apple.AppleMultitouchTrackpad" = {
            ActuateDetents = 1;
            TrackpadCornerSecondaryClick = 0;
            TrackpadHandResting = 1;
            TrackpadHorizScroll = 1;
            TrackpadMomentumScroll = 1;
            TrackpadPinch = 1;
            TrackpadRotate = 1;
            TrackpadScroll = 1;
            TrackpadFourFingerHorizSwipeGesture = 2;
            TrackpadFourFingerVertSwipeGesture = 2;
            TrackpadFourFingerPinchGesture = 2;
            TrackpadFiveFingerPinchGesture = 2;
            TrackpadThreeFingerHorizSwipeGesture = 0;
            TrackpadThreeFingerVertSwipeGesture = 0;
            TrackpadThreeFingerTapGesture = 0;
            TrackpadTwoFingerDoubleTapGesture = 1;
            TrackpadTwoFingerFromRightEdgeSwipeGesture = 3;
            USBMouseStopsTrackpad = 0;
          };
          "com.apple.driver.AppleBluetoothMultitouch.trackpad" = {
            TrackpadCornerSecondaryClick = 0;
            TrackpadHandResting = 1;
            TrackpadHorizScroll = 1;
            TrackpadMomentumScroll = 1;
            TrackpadPinch = 1;
            TrackpadRotate = 1;
            TrackpadScroll = 1;
            TrackpadFourFingerHorizSwipeGesture = 2;
            TrackpadFourFingerVertSwipeGesture = 2;
            TrackpadFourFingerPinchGesture = 2;
            TrackpadFiveFingerPinchGesture = 2;
            TrackpadThreeFingerHorizSwipeGesture = 0;
            TrackpadThreeFingerVertSwipeGesture = 0;
            TrackpadThreeFingerTapGesture = 0;
            TrackpadTwoFingerDoubleTapGesture = 1;
            TrackpadTwoFingerFromRightEdgeSwipeGesture = 3;
            USBMouseStopsTrackpad = 0;
          };
          "com.apple.driver.AppleBluetoothMultitouch.mouse" = {
            MouseHorizontalScroll = 1;
            MouseVerticalScroll = 1;
            MouseMomentumScroll = 1;
            MouseOneFingerDoubleTapGesture = 0;
            MouseTwoFingerDoubleTapGesture = 3;
            MouseTwoFingerHorizSwipeGesture = 2;
          };
          NSGlobalDomain = {
            "com.apple.mouse.doubleClickThreshold" = 0.15;
            "com.apple.scrollwheel.scaling" = 3.0;
            "com.apple.trackpad.forceClick" = 1;
          };
        };
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
