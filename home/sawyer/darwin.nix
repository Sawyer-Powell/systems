{ config, pkgs, lib, ... }:

{
  programs.bash.initExtra = ''
    alias switch="sudo darwin-rebuild switch --flake ~/repos/systems#macbook"
  '';

  home.file.".zshrc".text = lib.mkAfter ''
    alias switch="sudo darwin-rebuild switch --flake ~/repos/systems#macbook"
  '';
}
