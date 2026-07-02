{ config, pkgs, lib, ... }:

let
  polytoken = import ./polytoken.nix { inherit pkgs; };
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
    bitwarden-cli
    jjui
    jujutsu
    uv
    firefox
    ghostty
    neovim
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

  programs.bash = {
    enable = true;
    initExtra = ''
      alias vim=nvim
      alias vi=nvim
      alias switch="sudo nixos-rebuild switch --flake ."
    '';
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
