{ config, pkgs, lib, inputs, ... }:

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
  boot.kernelModules = [ "i2c-dev" ]; # DDC/CI for monitor control

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

  # Mullvad VPN daemon. Keep the Mullvad client package available, but do not
  # start the system daemon automatically at boot/login while the niri/Steam
  # session behavior is being stabilized.
  services.mullvad-vpn.enable = false;

  # ── Media server (Jellyfin) ─────────────────────────
  services.jellyfin = {
    enable = true;
    openFirewall = true;
    group = "media";
  };

  users.groups.media = {};
  users.users.jellyfin.extraGroups = [ "media" "render" "video" ];

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
    playerctl        # MPRIS media keys: play/pause/next/previous
    blueman          # Bluetooth GUI/manager

    # Niri X11 app support: Steam and other X11 apps need
    # xwayland-satellite in PATH for niri's automatic integration.
    xwayland-satellite

    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.brightness
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.eden
  ];

  # ── Niri Wayland compositor ────────────────────────
  programs.niri.enable = true;
  systemd.user.services.niri.enableDefaultPath = false;
  services.displayManager.sddm = {
    enable = true;
    wayland.enable = true;
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
