{
  description = "couchtop — gaming console NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    pi-agent = {
      url = "path:./pi-agent";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, pi-agent, ... }@inputs:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; };
  in
  {
    # ── Packages ────────────────────────────────────
    packages.${system} = {
      brightness = pkgs.writeShellScriptBin "brightness" ''
        set -e
        case "''${1:-show}" in
          show)  ddcutil getvcp 10 ;;
          up)    ddcutil setvcp 10 +10 ;;
          down)  cur=$(ddcutil getvcp 10 2>/dev/null | grep -oP 'current value =\s*\K[0-9]+')
                 new=$((cur - 10))
                 [ "$new" -lt 0 ] && new=0
                 ddcutil setvcp 10 "$new" ;;
          *)     ddcutil setvcp 10 "$1" ;;
        esac
      '';
    };

    # ── NixOS system configuration ──────────────────
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix
        { _module.args.inputs = inputs; }
      ];
    };
  };
}
