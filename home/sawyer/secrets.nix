{ config, pkgs, lib, ... }:

let
  # Add new shell secrets here. Values are 1Password item refs read by `op read`.
  secrets = {
    EXA_API_KEY = "op://Personal/Exa AI/credential";
  };

  secretLines = lib.concatStringsSep "\n"
    (lib.mapAttrsToList (name: ref: "${name}=${ref}") secrets);
in
{
  xdg.configFile."shell/secrets.sh".source = ../../dotfiles/shell/secrets.sh;
  xdg.configFile."shell/user-secrets.env".text = secretLines + "\n";
}
