{ config, pkgs, lib, inputs, ... }:

{
  imports = [ ./hardware-configuration.nix ];

  # ── Boot ────────────────────────────────────────────
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # RDNA 4 (9070 XT) needs bleeding-edge kernel + early KMS
  boot.kernelPackages = pkgs.linuxPackages_latest;
  boot.initrd.kernelModules = [ "amdgpu" ];
  boot.kernelModules = [ "i2c-dev" ];  # DDC/CI for monitor control

  # Quiet boot — straight into Steam, no text wall
  boot.kernelParams = [ "quiet" "splash" ];
  boot.plymouth.enable = true;

  # amd-pstate-epp is already active by default on kernel 6.5+ for Zen 5;
  # setting governor to performance changes the EPP hint to the SMU for
  # faster boost response.
  powerManagement.cpuFreqGovernor = "performance";

  # Reduce swap aggressiveness for a 32GB gaming desktop; disable proactive
  # memory compaction to eliminate background latency spikes.
  boot.kernel.sysctl = {
    "vm.swappiness" = 10;
    "vm.compaction_proactiveness" = 0;
  };

  # ── Networking ──────────────────────────────────────
  networking.hostName = "couchtop";
  networking.networkmanager.enable = true;

  # Mullvad VPN daemon. Keep the Mullvad client package available, but do not
  # start the system daemon automatically at boot/login while the niri/Steam
  # session behavior is being stabilized.
  services.mullvad-vpn.enable = false;

  # ── Locale ──────────────────────────────────────────
  time.timeZone = "America/Los_Angeles";

  # ── Graphics ────────────────────────────────────────
  hardware.graphics = {
    enable = true;
    enable32Bit = true;   # Steam needs 32-bit GL
    extraPackages = with pkgs; [
      libva-vdpau-driver
      libvdpau-va-gl
    ];
  };

  # Jellyfin hardware transcoding — jellyfin user needs render + video
  users.users.jellyfin.extraGroups = [ "media" "render" "video" ];

  # ── Audio ───────────────────────────────────────────
  services.pipewire = {
    enable = true;
    audio.enable = true;
    pulse.enable = true;
    alsa.enable = true;
    jack.enable = true;
  };

  # ── Media server (Jellyfin) ─────────────────────────
  services.jellyfin = {
    enable = true;
    openFirewall = true;           # opens port 8096
    group = "media";
  };

  users.groups.media = {};

  # ── Nixpkgs ────────────────────────────────────────
  nixpkgs.config.allowUnfree = true;

  # ── System packages ────────────────────────────────
  environment.systemPackages = with pkgs; [
    jq
    ripgrep
    python314
    cargo
    rustc
    rustfmt
    clippy
    (pkgs.mpv.override { youtubeSupport = false; })
    nodejs_22
    pnpm_9
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
  services.displayManager.autoLogin = {
    enable = true;
    user = "sawyer";
  };

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

  # ── 1Password ───────────────────────────────────────
  programs._1password.enable = true;
  programs._1password-gui = {
    enable = true;
    polkitPolicyOwners = [ "sawyer" ];
  };

  # ── User ────────────────────────────────────────────
  users.users.sawyer = {
    isNormalUser = true;
    initialPassword = "changeme";
    extraGroups = [
      "wheel"
      "networkmanager"
      "audio"
      "video"
      "render"
      "input"
      "gamemode"
      "i2c"
      "media"
    ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGaDe/QoajHR6CMl2DdVPtHyXCs5LuL3w8RBwi4xPquV sawyer@Sawyers-MacBook-Pro.local"
    ];
  };

  # ── GPG ────────────────────────────────────────────
  programs.gnupg.agent = {
    enable = true;
    pinentryPackage = pkgs.pinentry-gnome3;
    enableSSHSupport = true;             # lets GPG act as SSH agent
  };

  # ── SSH for remote management ───────────────────────
  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
  };

  # ── Firmware ────────────────────────────────────────
  hardware.enableRedistributableFirmware = true;

  # DDC/CI: let i2c group members talk to monitors
  users.groups.i2c = {};
  services.udev.extraRules = ''
    KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
    KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="2dc8", ATTRS{idProduct}=="6012", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
  '';

  # ── Gamepad / Bluetooth ─────────────────────────────
  hardware.xone.enable = true;       # Xbox wireless dongle
  hardware.steam-hardware.enable = true;  # udev rules + uinput for Steam Input
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
  };
  services.blueman.enable = true;

  # ── Nix settings ────────────────────────────────────
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  system.stateVersion = "25.11";
}
