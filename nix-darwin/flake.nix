{
  description = "Ino's nix-darwin configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    ewc.url = "github:tsukasaI/ewc";
    ewc.inputs.nixpkgs.follows = "nixpkgs";
    # ewc's transitive git-hooks input pins its own (older) nixpkgs unless told
    # to follow root here too (issue #12): without this, flake.lock ends up
    # with two materialized nixpkgs closures instead of one.
    ewc.inputs.git-hooks.inputs.nixpkgs.follows = "nixpkgs";
    fini.url = "github:tsukasaI/fini";
    fini.inputs.nixpkgs.follows = "nixpkgs";
    herdr.url = "github:ogulcancelik/herdr";
    herdr.inputs.nixpkgs.follows = "nixpkgs";
    shguard.url = "github:tsukasaI/shguard";
    shguard.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs, ewc, fini, herdr, shguard }:
  let
    # One function per host (#14): adding a second machine is one more mkHost
    # call under darwinConfigurations, not a copy of the configuration block.
    mkHost = { primaryUser, system }:
    let
    configuration = { pkgs, lib, ... }:
    let
      # NOTE (issue #27): this does NOT actually give nvim precompiled parsers at
      # runtime. In practice nvim-treesitter (the lazy.nvim plugin) self-compiles
      # go/rust/toml/etc. into ~/.local/share/nvim/site/parser/*.so on first use,
      # using the Xcode CLT C toolchain — this derivation's rtp prepend has no
      # observed effect. `proto` dropped below since it never shows up in the
      # resulting parser list either way.
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

      trackpadGestures = {
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
    in
    {
      environment.systemPackages = [
        ewc.packages.${system}.default
        fini.packages.${system}.default
        herdr.packages.${system}.default
        shguard.packages.${system}.default
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
        gitleaks
        lefthook
        shellcheck

        # Cloud / DevOps
        awscli2
        gh
        terraform

        # Node / TypeScript
        bun
        nodejs
        pnpm
        pi-coding-agent

        # Go (LSP, formatters, debugger for nvim-dap-go)
        go
        gopls
        gofumpt
        gotools # goimports
        delve

        # Python
        uv

        # Rust (LSP, formatter, linter for nvim)
        cargo
        rustc
        clippy
        rustfmt
        rust-analyzer
        lldb
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
          # Homebrew 5.1+ requires --force-cleanup for `brew bundle ... --cleanup`.
          # nix-darwin fix (PR #1789) is unmerged; drop this once it lands.
          extraFlags = [ "--force-cleanup" ];
        };

        taps = [
          # trusted: Homebrew 5.1+ blocks formulae from untrusted third-party taps.
          { name = "bendews/tap"; trusted = true; }  # apw (Apple Passwords CLI)
          { name = "tursodatabase/tap"; trusted = true; }  # turso (libSQL cloud CLI)
          { name = "libsql/sqld"; trusted = true; }  # sqld (turso CLI dependency)
          { name = "ariga/tap"; trusted = true; }  # atlas (DB schema migration tool)
          { name = "charmbracelet/tap"; trusted = true; }  # freeze (code screenshot tool)
        ];

        # Nixに移行しないformulae
        brews = [
          "deck"
          "mise"
          "yt-dlp"
          "apw"  # Apple Passwords CLI
          "tursodatabase/tap/turso"  # libSQL/Turso cloud CLI (core "turso" is a different DB engine)
          "ariga/tap/atlas"  # Atlas DB schema migration tool
          "charmbracelet/tap/freeze"  # generate code screenshots as images
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
          "com.apple.AppleMultitouchTrackpad" = trackpadGestures // {
            ActuateDetents = 1;
          };
          "com.apple.driver.AppleBluetoothMultitouch.trackpad" = trackpadGestures;
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
      # Store hygiene (issue #12): without these the Nix store grows
      # unbounded — nothing here ever reclaims old generations/derivations.
      nix.optimise.automatic = true;
      nix.gc = {
        automatic = true;
        interval = { Weekday = 0; };
        options = "--delete-older-than 30d";
      };
      system.primaryUser = primaryUser;
      system.stateVersion = 5;
      nixpkgs.hostPlatform = system;
    };
    in
    nix-darwin.lib.darwinSystem {
      modules = [ configuration ];
    };
  in
  {
    darwinConfigurations."Ino-macbook-air" = mkHost {
      primaryUser = "inouetsukasa";
      system = "aarch64-darwin";
    };
  };
}
