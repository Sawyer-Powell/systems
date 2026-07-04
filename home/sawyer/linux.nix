{ config, pkgs, lib, ... }:

let
  bigSurWallpaper = ../../dotfiles/wallpapers/macos-big-sur-dark.jpg;

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

  screenshotToClipboard = pkgs.writeShellApplication {
    name = "screenshot-to-clipboard";
    runtimeInputs = with pkgs; [ grim slurp wl-clipboard libnotify ];
    text = ''
      geometry=$(slurp)
      grim -g "$geometry" -t png - | wl-copy --type image/png
      notify-send "Screenshot copied" "Selected area copied to clipboard."
    '';
  };
in
{
  # ── Linux desktop/user packages ─────────────────────
  home.packages = with pkgs; [
    qbittorrent
    mullvad
    ghostty
    fuzzel
    zed-editor
    obsidian
    screenshotToClipboard
    swaybg

    pavucontrol
    helvum
    luminance
  ];

  # Niri does not start a Polkit authentication agent for us. 1Password's
  # "Unlock using system authentication" uses Polkit/PAM, so keep an agent
  # running in the graphical user session.
  services.polkit-gnome.enable = true;

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
        "@luminance@"
        "@wpctl@"
        "@playerctl@"
        "@monitorBrightness@"
        "@onePassword@"
        "@swaybg@"
        "@bigSurWallpaper@"
        "@screenshotToClipboard@"
        "@cursorTheme@"
        "@cursorSize@"
      ]
      [
        "${pkgs.ghostty}/bin/ghostty"
        "${pkgs.fuzzel}/bin/fuzzel"
        "${niriWindowSwitcher}/bin/niri-window-switcher"
        "${pkgs.firefox}/bin/firefox"
        "${pkgs.blueman}/bin/blueman-manager"
        "${pkgs.luminance}/bin/com.sidevesh.Luminance"
        "${pkgs.wireplumber}/bin/wpctl"
        "${pkgs.playerctl}/bin/playerctl"
        "${monitorBrightness}/bin/monitor-brightness"
        "${pkgs._1password-gui}/bin/1password"
        "${pkgs.swaybg}/bin/swaybg"
        "${bigSurWallpaper}"
        "${screenshotToClipboard}/bin/screenshot-to-clipboard"
        "Bibata-Modern-Ice"
        "24"
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
