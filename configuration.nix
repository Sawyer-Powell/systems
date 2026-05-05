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

  # ── Networking ──────────────────────────────────────
  networking.hostName = "couchtop";
  networking.networkmanager.enable = true;

  # Mullvad VPN daemon
  services.mullvad-vpn.enable = true;
  systemd.services.mullvad-auto-connect = {
    description = "Enable Mullvad auto-connect";
    after = [ "mullvad-daemon.service" ];
    wants = [ "mullvad-daemon.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.mullvad}/bin/mullvad auto-connect set on";
      RemainAfterExit = true;
    };
  };

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
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.brightness
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.pi
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.eden
  ];

  # ── KDE Plasma Desktop ─────────────────────────────
  # SDDM auto-logs into KDE, which is the Wayland compositor
  # (replacing gamescope). All system controls built-in.
  services.desktopManager.plasma6.enable = true;
  services.displayManager.sddm = {
    enable = true;
    wayland.enable = true;
  };
  services.displayManager.autoLogin = {
    enable = true;
    user = "sawyer";
  };

  # ── Steam + Gaming ─────────────────────────────────
  programs.steam = {
    enable = true;
    remotePlay.openFirewall = true;
  };
  programs.gamemode.enable = true;

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
    pinentryPackage = pkgs.pinentry-qt;  # works with KDE/Plasma
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
  '';

  # ── Gamepad / Bluetooth ─────────────────────────────
  hardware.xone.enable = true;       # Xbox wireless dongle
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
  };

  # ── Nix settings ────────────────────────────────────
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  system.stateVersion = "25.11";
}
