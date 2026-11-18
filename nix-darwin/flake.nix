{
  description = "Ino's nix-darwin configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    ewc.url = "github:tsukasaI/ewc";
    ewc.inputs.nixpkgs.follows = "nixpkgs";
    # Without this, git-hooks pins a second nixpkgs into flake.lock (issue #12).
    ewc.inputs.git-hooks.inputs.nixpkgs.follows = "nixpkgs";
    fini.url = "github:tsukasaI/fini";
    fini.inputs.nixpkgs.follows = "nixpkgs";
    herdr.url = "github:ogulcancelik/herdr";
    herdr.inputs.nixpkgs.follows = "nixpkgs";
    # Source only, pinned to the release tag: ./shguard.nix builds it, since
    # shguard's flake has no package output yet (tsukasaI/shguard#1114).
    shguard.url = "github:tsukasaI/shguard/v0.13.0";
    shguard.flake = false;
  };

  outputs = { nixpkgs, nix-darwin, ewc, fini, herdr, shguard, ... }:
  let
    shguardFor = pkgs: pkgs.callPackage ./shguard.nix { src = shguard; };
    diagramRenderFor = pkgs: pkgs.callPackage ./diagram-render.nix { };
    jaLintFor = pkgs: pkgs.callPackage ./ja-lint.nix { };
    mkHost = { primaryUser, system }:
    let
    configuration = { pkgs, lib, ... }:
    let
      # No observed effect: nvim-treesitter compiles its own parsers on first
      # use with the Xcode CLT toolchain (issue #27).
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
        # Not extra-sandbox-paths for /bin/cp and /usr/bin/ranlib: that would
        # open host binaries to every build. Drop once herdr's own
        # nix/package.nix patches these vendored libghostty-vt build steps.
        (herdr.packages.${system}.default.overrideAttrs (old: {
          postPatch = (old.postPatch or "") + ''
            pushd vendor/libghostty-vt
            substituteInPlace src/build/LibtoolStep.zig \
              --replace-fail /bin/cp ${pkgs.coreutils}/bin/cp \
              --replace-fail /usr/bin/ranlib ${pkgs.cctools}/bin/ranlib
            substituteInPlace src/build/GhosttyLibVt.zig \
              --replace-fail /bin/ln ${pkgs.coreutils}/bin/ln
            substituteInPlace pkg/apple-sdk/native_link.zig \
              --replace-fail /usr/bin/xcrun ${pkgs.xcbuild}/bin/xcrun
            popd
          '';
        }))
        (shguardFor pkgs)
        (diagramRenderFor pkgs)
        (jaLintFor pkgs)
        (pkgs.callPackage ./career-consistency.nix { opsDir = "/Users/${primaryUser}/engineer/ops"; })
        (pkgs.callPackage ./dream-extract.nix { inherit primaryUser; opsDir = "/Users/${primaryUser}/engineer/ops"; })
        (pkgs.callPackage ./prepush-sandbox.nix { })
      ] ++ (with pkgs; [
        bat
        eza
        fd
        ripgrep
        procs
        zoxide
        fzf
        jq
        tokei

        gnupg

        neovimWithParsers
        git
        lazygit
        gitleaks
        lefthook
        shellcheck

        awscli2
        gh
        terraform

        bun
        nodejs
        pnpm
        pi-coding-agent # run via ~/.local/bin/pi-factory, not bare `pi`
        agent-browser # run as a user-scope MCP server, not from Bash: Chromium can't launch in the Bash sandbox

        # Not `go`: it lags a minor release behind on a slower-moving alias.
        go_latest
        gopls
        gofumpt
        gotools
        delve

        uv

        cargo
        rustc
        clippy
        rustfmt
        rust-analyzer
        lldb
      ]);

      security.pam.services.sudo_local = {
        touchIdAuth = true;
        reattach = true;
      };

      homebrew = {
        enable = true;
        onActivation = {
          autoUpdate = true;
          upgrade = true;
          cleanup = "zap";
        };

        taps = [
          # trusted: Homebrew 5.1+ blocks formulae from untrusted third-party taps.
          { name = "bendews/tap"; trusted = true; }
          { name = "tursodatabase/tap"; trusted = true; }
          { name = "libsql/sqld"; trusted = true; }  # sqld (turso CLI dependency)
          { name = "ariga/tap"; trusted = true; }
          { name = "charmbracelet/tap"; trusted = true; }
          { name = "abue-ammar/tinycast"; trusted = true; }
        ];

        brews = [
          "deck"
          "mise"
          "yt-dlp"
          "apw"
          "container"  # used by pi-factory --container
          "tursodatabase/tap/turso"  # not core "turso": that is a different DB engine
          "ariga/tap/atlas"
          "charmbracelet/tap/freeze"
        ];

        casks = [
          "ghostty"
          "wezterm"
          "orbstack"
          "karabiner-elements"
          "session-manager-plugin"
          "font-plemol-jp-nf"
          "font-blex-mono-nerd-font"
          "abue-ammar/tinycast/tinycast"
          "raycast"  # not redundant with tinycast: fallback launcher; removing it zaps its settings
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
      # Not darwin's default `false`: the Claude Code sandbox may reach the
      # nix daemon socket, and an unsandboxed builder would be its way out.
      nix.settings.sandbox = true;
      nix.optimise.automatic = true;
      nix.gc = {
        automatic = true;
        # An option definition replaces the launchd StartCalendarInterval
        # default wholesale, not per-field — omitting Hour/Minute here does
        # NOT default them to 0, it leaves them as launchd's own wildcard,
        # so the job fires every minute all day on Weekday 0 instead of once.
        interval = { Weekday = 0; Hour = 3; Minute = 15; };
        options = "--delete-older-than 30d";
      };
      # Start gpg-agent/keyboxd at login. When the first gpg call of a login
      # comes from the Claude Code Bash sandbox, gpg cannot spawn them (the
      # spawn dotlock lives in the write-denied ~/.gnupg), so signed commits
      # fail until something outside the sandbox launches them.
      launchd.user.agents.gnupg-daemons = {
        # Not an `a && b` command string: nix-darwin prefixes it with `exec`,
        # which would end the shell before the second launch.
        command = "${pkgs.writeShellScript "gnupg-launch-daemons" ''
          ${pkgs.gnupg}/bin/gpgconf --launch gpg-agent
          ${pkgs.gnupg}/bin/gpgconf --launch keyboxd
        ''}";
        serviceConfig.RunAtLoad = true;
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
    # CI's parity job builds the same derivation on Linux from this lock.
    packages = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-linux" ] (system: {
      shguard = shguardFor nixpkgs.legacyPackages.${system};
      diagram-render = diagramRenderFor nixpkgs.legacyPackages.${system};
      ja-lint = jaLintFor nixpkgs.legacyPackages.${system};
    });

    darwinConfigurations."Ino-macbook-air" = mkHost {
      primaryUser = "inouetsukasa";
      system = "aarch64-darwin";
    };
  };
}
