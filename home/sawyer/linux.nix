{ config, pkgs, lib, ... }:

let
  monitorBrightness = pkgs.writeShellApplication {
    name = "monitor-brightness";
    runtimeInputs = with pkgs; [ ddcutil gnugrep ];
    text = builtins.readFile ../../dotfiles/scripts/monitor-brightness;
  };

  niriWindowSwitcher = pkgs.writeShellApplication {
    name = "niri-window-switcher";
    runtimeInputs = with pkgs; [ niri jq fuzzel ];
    text = builtins.readFile ../../dotfiles/scripts/niri-window-switcher;
  };
in
{
  # ── Linux desktop/user packages ─────────────────────
  home.packages = with pkgs; [
    qbittorrent
    mullvad
    ghostty
    fuzzel

    pavucontrol
    helvum
  ];

  programs.bash.initExtra = ''
    alias switch="sudo nixos-rebuild switch --flake ."
  '';

  home.file.".zshrc".text = lib.mkAfter ''
    alias switch="sudo nixos-rebuild switch --flake ."
  '';


  # Niri config lives in dotfiles/niri/config.kdl. Home Manager still
  # substitutes absolute Nix store paths for launchers so the session does not
  # depend on whatever PATH niri/systemd inherited.
  xdg.configFile."niri/config.kdl" = {
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
      (builtins.readFile ../../dotfiles/niri/config.kdl);
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
}
