{ config, pkgs, lib, ... }:

let
  polytoken = import ./polytoken.nix { inherit pkgs; };

  monitorBrightness = pkgs.writeShellApplication {
    name = "monitor-brightness";
    runtimeInputs = with pkgs; [ ddcutil gnugrep ];
    text = builtins.readFile ./dotfiles/scripts/monitor-brightness;
  };

  niriWindowSwitcher = pkgs.writeShellApplication {
    name = "niri-window-switcher";
    runtimeInputs = with pkgs; [ niri jq fuzzel ];
    text = builtins.readFile ./dotfiles/scripts/niri-window-switcher;
  };
in
{
  home.username = "sawyer";
  home.homeDirectory = "/home/sawyer";

  # ── Packages just for your user ─────────────────────
  home.packages = with pkgs; [
    gimp
    zellij
    btop
    ripgrep
    qbittorrent
    fd
    mullvad
    jq
    gh
    git
    _1password-cli
    _1password-gui
    jjui
    jujutsu
    uv
    firefox
    ghostty
    fuzzel
    neovim
    tree-sitter

    # Generic native build tooling for editor plugins and local development.
    gcc
    gnumake
    pkg-config
    cmake
    ninja

    zsh
    polytoken
  ];

  # ── Git ─────────────────────────────────────────────
  programs.git = {
    enable = true;

    # Modern settings style (replaces userName/userEmail/extraConfig)
    settings = {
      user.name = "Sawyer Powell";
      user.email = "sawyerhpowell@gmail.com";

      user.signingkey = "3A3CA3284DF8431A";
      commit.gpgsign = true;
      tag.gpgsign = true;

      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
    };
  };

  # ── Neovim as default editor everywhere ─────────────
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
  };

  xdg.configFile."shell/secrets.sh".source = ./dotfiles/shell/secrets.sh;

  programs.bash = {
    enable = true;
    initExtra = ''
      alias vim=nvim
      alias vi=nvim
      alias switch="sudo nixos-rebuild switch --flake ."
      source "$HOME/.config/shell/secrets.sh"
    '';
  };

  home.file.".zshrc" = {
    force = true;
    text = ''
      alias vim=nvim
      alias vi=nvim
      alias switch="sudo nixos-rebuild switch --flake ."
      source "$HOME/.config/shell/secrets.sh"
    '';
  };

  # ── Imported dotfiles ────────────────────────────────
  xdg.configFile."nvim" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/nvim";
    force = true;
  };
  xdg.configFile."zellij" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/zellij";
    force = true;
  };
  xdg.configFile."ghostty" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/ghostty";
    force = true;
  };
  xdg.configFile."zed/settings.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/zed/settings.json";
    force = true;
  };
  xdg.configFile."zed/keymap.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/zed/keymap.json";
    force = true;
  };
  xdg.configFile."zed/tasks.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "/home/sawyer/nixos-config/dotfiles/zed/tasks.json";
    force = true;
  };

  # Niri config lives in dotfiles/niri/config.kdl. Home Manager still
  # substitutes absolute Nix store paths for launchers so the session does not
  # depend on whatever PATH niri/systemd inherited.
  xdg.configFile."niri/config.kdl" = {
    # Replace the stock/example config that niri created as a regular file.
    # Without force, Home Manager will not take ownership of an existing file.
    force = true;
    text = builtins.replaceStrings
      [
        "@ghostty@"
        "@fuzzel@"
        "@niriWindowSwitcher@"
        "@firefox@"
        "@bluemanManager@"
        "@wpctl@"
        "@playerctl@"
        "@monitorBrightness@"
      ]
      [
        "${pkgs.ghostty}/bin/ghostty"
        "${pkgs.fuzzel}/bin/fuzzel"
        "${niriWindowSwitcher}/bin/niri-window-switcher"
        "${pkgs.firefox}/bin/firefox"
        "${pkgs.blueman}/bin/blueman-manager"
        "${pkgs.wireplumber}/bin/wpctl"
        "${pkgs.playerctl}/bin/playerctl"
        "${monitorBrightness}/bin/monitor-brightness"
      ]
      (builtins.readFile ./dotfiles/niri/config.kdl);
  };

  # Steam is installed, but do not auto-launch it while the niri session and
  # xwayland-satellite setup are being stabilized. Steam may create XDG
  # autostart entries itself, so remove the common variants on activation.
  home.activation.disableSteamAutostart = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    rm -f \
      "$HOME/.config/autostart/steam.desktop" \
      "$HOME/.config/autostart/Steam.desktop" \
      "$HOME/.config/autostart/steam"*.desktop \
      "$HOME/.config/autostart/Steam"*.desktop
  '';

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  home.stateVersion = "25.11";
}
