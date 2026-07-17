{ config, pkgs, lib, inputs, ... }:

let
  bigSurWallpaper = ../../dotfiles/wallpapers/macos-big-sur-dark.jpg;

  sddmBigSurTheme = pkgs.stdenvNoCC.mkDerivation {
    pname = "sddm-big-sur-theme";
    version = "1.0";
    src = ../../dotfiles/sddm/big-sur;

    installPhase = ''
      mkdir -p $out/share/sddm/themes/big-sur/Backgrounds
      cp -r . $out/share/sddm/themes/big-sur
      cp ${bigSurWallpaper} $out/share/sddm/themes/big-sur/Backgrounds/macos-big-sur-dark.jpg
    '';
  };
in
{
  imports = [
    ./hardware-configuration.nix
    ../../nixos.nix
  ];

  # ── Identity ────────────────────────────────────────
  networking.hostName = "couchtop";

  # ── Boot / hardware tuning ──────────────────────────
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # RDNA 4 (9070 XT) needs bleeding-edge kernel + early KMS.
  boot.kernelPackages = pkgs.linuxPackages_latest;
  boot.initrd.kernelModules = [ "amdgpu" ];

  # Bridge the external monitor's DDC/CI brightness control into the standard
  # Linux backlight interface so Waybar can provide a native slider.
  boot.extraModulePackages = [ config.boot.kernelPackages.ddcci-driver ];
  boot.kernelModules = [ "i2c-dev" "ddcci" "ddcci_backlight" ];

  # Linux 6.8+ no longer provides the I2C auto-probing API used by the DDC/CI
  # driver. Discover actual DDC displays at runtime and attach only their buses;
  # I2C bus numbers are assigned dynamically and must not be hard-coded.
  systemd.services.ddcci-attach = {
    description = "Attach DDC/CI monitors to the Linux backlight interface";
    wantedBy = [ "graphical.target" ];
    before = [ "display-manager.service" ];
    after = [ "systemd-modules-load.service" "systemd-udev-settle.service" ];
    wants = [ "systemd-udev-settle.service" ];
    path = [ pkgs.ddcutil pkgs.coreutils pkgs.gawk ];
    script = ''
      set -eu

      ddcutil detect --brief 2>/dev/null \
        | awk '/I2C bus:/ { sub("^/dev/", "", $3); print $3 }' \
        | while read -r bus; do
            [ -n "$bus" ] || continue
            bus_number="''${bus#i2c-}"
            if [ ! -e "/sys/bus/i2c/devices/$bus_number-0037" ]; then
              echo "ddcci 0x37" > "/sys/bus/i2c/devices/$bus/new_device"
            fi
          done
    '';
    serviceConfig.Type = "oneshot";
  };

  # Quiet boot — straight into Steam, no text wall.
  boot.kernelParams = [ "quiet" "splash" ];
  boot.plymouth.enable = true;

  # amd-pstate-epp is already active by default on kernel 6.5+ for Zen 5;
  # setting governor to performance changes the EPP hint to the SMU for faster boost response.
  powerManagement.cpuFreqGovernor = "performance";

  # Reduce swap aggressiveness for a 32GB gaming desktop; disable proactive
  # memory compaction to eliminate background latency spikes.
  boot.kernel.sysctl = {
    "vm.swappiness" = 10;
    "vm.compaction_proactiveness" = 0;
  };

  # Mullvad VPN daemon. The CLI and GUI require this system service.
  services.mullvad-vpn.enable = true;

  # Tailscale mesh VPN. Authentication remains an explicit one-time
  # `sudo tailscale up` so no reusable auth key is stored in this repository.
  services.tailscale = {
    enable = true;
    openFirewall = true;
  };

  # ── Media server (Jellyfin) ─────────────────────────
  services.jellyfin = {
    enable = true;
    openFirewall = true;
    group = "media";
  };

  users.groups.media = {};
  users.users.jellyfin.extraGroups = [ "media" "render" "video" ];

  # Desktop file-management support: trash/network locations and removable drives.
  services.gvfs.enable = true;
  services.udisks2.enable = true;

  # ── System packages ────────────────────────────────
  environment.systemPackages = with pkgs; [
    jq
    ripgrep
    gh
    python314
    cargo
    rustc
    rustfmt
    clippy
    (pkgs.mpv.override { youtubeSupport = false; })
    nodejs_22
    pnpm
    ddcutil          # monitor brightness via DDC/CI
    nautilus          # graphical file manager
    fooyin            # local music library player with MPRIS support
    playerctl         # MPRIS media keys: play/pause/next/previous
    blueman           # Bluetooth GUI/manager
    bibata-cursors   # Shared cursor theme for SDDM and Niri
    sddmBigSurTheme  # SDDM greeter theme

    # Niri X11 app support: Steam and other X11 apps need
    # xwayland-satellite in PATH for niri's automatic integration.
    xwayland-satellite

    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.brightness
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.eden
  ];

  # Waybar uses Nerd Font symbols for its compact status controls. Keep the
  # text and icon families Nix-managed so icon rendering does not depend on a
  # manually installed user font.
  fonts.packages = [ pkgs.nerd-fonts.jetbrains-mono ];

  # ── Niri Wayland compositor ────────────────────────
  programs.niri.enable = true;
  systemd.user.services.niri.enableDefaultPath = false;
  services.displayManager.sddm = {
    enable = true;
    wayland = {
      enable = true;
      compositor = "kwin";
    };
    theme = "big-sur";
    extraPackages = [ sddmBigSurTheme ];

    # Keep SDDM's greeter cursor in sync with Niri's cursor config.
    # SDDM/Wayland cursor handling is compositor-dependent; using KWin avoids
    # Weston greeter cursor issues and needs Qt layer-shell integration.
    settings = {
      General.GreeterEnvironment = "QT_WAYLAND_SHELL_INTEGRATION=layer-shell,XCURSOR_THEME=Bibata-Modern-Ice,XCURSOR_SIZE=24";
      Theme = {
        CursorTheme = "Bibata-Modern-Ice";
        CursorSize = 24;
      };
    };
  };
  services.displayManager.defaultSession = "niri";

  # Password login lets PAM unlock the user's Secret Service keyring at session start.
  services.displayManager.autoLogin.enable = false;

  # ── Steam + Gaming ─────────────────────────────────
  programs.steam = {
    enable = true;
    remotePlay.openFirewall = true;
    # Work around Steam Input / Steam Controller mouse emulation on Wayland
    # by preloading libextest.so into Steam. This translates XTEST-style
    # input into uinput events, which helps when niri lacks native EIS/libei
    # emulated-input support.
    extest.enable = true;
  };

  environment.sessionVariables = {
    SDL_JOYSTICK_HIDAPI = "1";
    SDL_JOYSTICK_HIDAPI_8BITDO = "1";
  };

  programs.gamemode.enable = true;
  programs.gamescope.enable = true;

  # ── User host-specific groups ───────────────────────
  users.users.sawyer.extraGroups = [
    "gamemode"
    "i2c"
    "media"
  ];

  # DDC/CI: let i2c group members talk to monitors.
  users.groups.i2c = {};
  services.udev.extraRules = ''
    KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
    KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="2dc8", ATTRS{idProduct}=="6012", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
  '';

  # ── Gamepad hardware ───────────────────────────────
  hardware.xone.enable = true;              # Xbox wireless dongle
  hardware.steam-hardware.enable = true;    # udev rules + uinput for Steam Input

  system.stateVersion = "25.11";
}
