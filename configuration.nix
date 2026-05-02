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

  # ── Locale ──────────────────────────────────────────
  time.timeZone = "America/Los_Angeles";

  # ── Graphics ────────────────────────────────────────
  hardware.graphics = {
    enable = true;
    enable32Bit = true;   # Steam needs 32-bit GL
  };

  # ── Audio ───────────────────────────────────────────
  services.pipewire = {
    enable = true;
    audio.enable = true;
    pulse.enable = true;
    alsa.enable = true;
    jack.enable = true;
  };

  # ── Nixpkgs ────────────────────────────────────────
  nixpkgs.config.allowUnfree = true;

  # ── System packages ────────────────────────────────
  environment.systemPackages = with pkgs; [
    fd
    bitwarden-cli
    ripgrep
    python314
    cargo
    rustc
    rustfmt
    clippy
    jjui
    jujutsu
    uv
    (pkgs.mpv.override { youtubeSupport = false; })
    firefox
    ghostty
    neovim
    git
    nodejs_22
    pnpm_9
    ddcutil          # monitor brightness via DDC/CI
    inputs.self.packages.${pkgs.system}.brightness
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
  programs.steam.enable = true;
  programs.gamemode.enable = true;
  systemd.user.services.steam-big-picture = {
    description = "Steam Big Picture Mode";
    wantedBy = [ "graphical-session.target" ];
    partOf = [ "graphical-session.target" ];
    serviceConfig = {
      ExecStart = "steam -gamepadui";
      Restart = "on-failure";
      RestartSec = 5;
    };
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
      "input"
      "gamemode"
      "i2c"
    ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGaDe/QoajHR6CMl2DdVPtHyXCs5LuL3w8RBwi4xPquV sawyer@Sawyers-MacBook-Pro.local"
    ];
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
