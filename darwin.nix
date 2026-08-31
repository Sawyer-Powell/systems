{ config, pkgs, lib, username, userHome, ... }:

{
  nixpkgs.config.allowUnfree = true;

  # Nix itself is installed and managed by Determinate Systems on macOS.
  # Let nix-darwin manage the rest of the system, but do not let it take over
  # the Nix daemon or nix.conf.
  nix.enable = false;

  system.stateVersion = 7;
  system.primaryUser = username;

  users.users.${username}.home = userHome;

  homebrew.enable = true;
}
