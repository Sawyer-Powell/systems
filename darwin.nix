{ config, pkgs, lib, ... }:

{
  nixpkgs.config.allowUnfree = true;

  # Nix itself is installed and managed by Determinate Systems on macOS.
  # Let nix-darwin manage the rest of the system, but do not let it take over
  # the Nix daemon or nix.conf.
  nix.enable = false;

  system.stateVersion = 7;
  system.primaryUser = "sawyer";

  users.users.sawyer.home = "/Users/sawyer";

  # The 1Password GUI app is typically installed as a Homebrew cask on macOS,
  # while the CLI remains managed by Home Manager/nixpkgs.
  homebrew = {
    enable = true;
    casks = [
      "1password"
      "docker-desktop"
      "firefox"
      "ghostty"
      "gimp"
      "prismlauncher"
      "zed"
    ];
  };
}
