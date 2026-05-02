{ config, pkgs, lib, ... }:

{
  home.username = "sawyer";
  home.homeDirectory = "/home/sawyer";

  # ── Packages just for your user ─────────────────────
  home.packages = with pkgs; [
    # CLI tools you reach for daily
    ripgrep
    fd
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
    '';
  };

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  home.stateVersion = "25.11";
}
