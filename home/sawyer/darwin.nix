{ config, pkgs, lib, systemsDir, systemConfigName, ... }:

{
  programs.bash.initExtra = ''
    alias switch="sudo darwin-rebuild switch --flake ${systemsDir}#${systemConfigName}"
  '';

  home.file.".zshrc".text = lib.mkAfter ''
    alias switch="sudo darwin-rebuild switch --flake ${systemsDir}#${systemConfigName}"
  '';
}
