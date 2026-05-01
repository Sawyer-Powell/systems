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
  # TODO: adjust timezone for your location
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
    neovim
    git
    nodejs_22
    pnpm_9
    ddcutil          # monitor brightness via DDC/CI
    inputs.self.packages.${pkgs.system}.brightness
  ];

  # ── Gamescope + Steam ───────────────────────────────
  programs.gamescope = {
    enable = true;
    capSysNice = true;
  };

  programs.steam = {
    enable = true;
    gamescopeSession.enable = true;
  };

  programs.gamemode.enable = true;

  # ── Auto-login → Steam Big Picture ──────────────────
  # greetd replaces the display manager. On boot, it auto-logs
  # in as "sawyer" and launches gamescope with Steam Big Picture.
  # If Steam crashes, greetd restarts the session automatically.
  services.greetd = {
    enable = true;
    settings = {
      default_session = {
        user = "sawyer";
        command = "${lib.getExe pkgs.gamescope} --steam --prefer-vk-device 1002:7550 --adaptive-sync --hdr-enabled --hdr-itm-enabled -- steam -gamepadui -pipewire-dmabuf";
      };
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
      "i2c"             # DDC/CI monitor control
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
