{ config, pkgs, lib, inputs, ... }:

{
  # ── Nixpkgs / Nix ───────────────────────────────────
  nixpkgs.config.allowUnfree = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  # ── Locale ──────────────────────────────────────────
  time.timeZone = "America/Los_Angeles";

  # ── Networking ──────────────────────────────────────
  networking.networkmanager.enable = true;

  # ── Audio ───────────────────────────────────────────
  services.pipewire = {
    enable = true;
    audio.enable = true;
    pulse.enable = true;
    alsa.enable = true;
    jack.enable = true;
  };

  # ── Graphics ────────────────────────────────────────
  hardware.graphics = {
    enable = true;
    enable32Bit = true;
    extraPackages = with pkgs; [
      libva-vdpau-driver
      libvdpau-va-gl
    ];
  };

  # ── 1Password ───────────────────────────────────────
  programs._1password.enable = true;
  programs._1password-gui = {
    enable = true;
    polkitPolicyOwners = [ "sawyer" ];
  };

  # ── User ────────────────────────────────────────────
  users.users.sawyer = {
    isNormalUser = true;
    extraGroups = [
      "wheel"
      "networkmanager"
      "audio"
      "video"
      "render"
      "input"
    ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGaDe/QoajHR6CMl2DdVPtHyXCs5LuL3w8RBwi4xPquV sawyer@Sawyers-MacBook-Pro.local"
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF1AbbXZzfx3O4xtwBzMSGetMEy9AfLRHwdN339qE2gq id_ed25519"
    ];
  };

  # ── SSH for remote management ───────────────────────
  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
  };

  # ── Firmware / Bluetooth ────────────────────────────
  hardware.enableRedistributableFirmware = true;
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
  };
  services.blueman.enable = true;
}
