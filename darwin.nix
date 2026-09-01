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
   fonts.packages = [ pkgs.nerd-fonts.jetbrains-mono ];
 
   # The 1Password GUI app is typically installed as a Homebrew cask on macOS,
   # while the CLI remains managed by Home Manager/nixpkgs.
   homebrew = {
     enable = true;
     taps = [ "d12frosted/emacs-plus" ];
     brews = [
       "gcc"
       "libgccjit"
     ];
     casks = [
       "1password"
       "docker-desktop"
       "d12frosted/emacs-plus/emacs-plus-app"
       "firefox"
       "ghostty"
       "gimp"
       "prismlauncher"
       "zed"
     ];
   };
}
