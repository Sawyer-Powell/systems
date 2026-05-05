{ config, pkgs, lib, ... }:

{
  home.username = "sawyer";
  home.homeDirectory = "/home/sawyer";

  # ── Packages just for your user ─────────────────────
  home.packages = with pkgs; [
    ripgrep
    claude-code
    qbittorrent
    fd
    mullvad
    jq
    gh
    git
    bitwarden-cli
    jjui
    jujutsu
    uv
    firefox
    ghostty
    neovim
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

  programs.bash = {
    enable = true;
    initExtra = ''
      alias vim=nvim
      alias vi=nvim
      alias switch="sudo nixos-rebuild switch --flake ."
    '';
  };

  # Auto-launch Steam in Big Picture mode when KDE starts
  xdg.configFile."autostart/steam.desktop".text = ''
    [Desktop Entry]
    Type=Application
    Name=Steam
    Exec=steam -gamepadui
    Hidden=false
  '';

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  home.stateVersion = "25.11";
}
