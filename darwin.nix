{ config, pkgs, lib, ... }:

{
  nixpkgs.config.allowUnfree = true;

  # nix-darwin defaults for future macOS hosts. Keep this broad and small until
  # there is a real Mac host using it.
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # The 1Password GUI app is typically installed as a Homebrew cask on macOS,
  # while the CLI remains managed by Home Manager/nixpkgs.
  homebrew = {
    enable = true;
    casks = [
      "1password"
      "firefox"
      "gimp"
    ];
  };
}
