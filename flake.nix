{
  description = "couchtop — gaming console NixOS";

  # ── Inputs: where do my dependencies come from? ─────
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  # ── Outputs: what does this flake produce? ──────────
  outputs = { self, nixpkgs, ... }@inputs:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; };
  in
  {
    # ── Overlays: extend nixpkgs with our packages ────
    # An overlay is a function (final: prev: { ... }) that
    # adds or overrides packages. `callPackage` auto-fills
    # function arguments from nixpkgs.
    overlays.default = final: prev: {
      decky-loader = final.callPackage ./packages/decky-loader.nix { };
    };

    # ── NixOS modules: reusable config pieces ─────────
    # Importing this gives you `services.decky-loader.enable`.
    nixosModules.default = ./modules/decky-loader.nix;

    # ── Standalone packages (nix build / nix run) ─────
    packages.${system} = {
      brightness = pkgs.writeShellScriptBin "brightness" ''
        set -e
        case "''${1:-show}" in
          show)  ddcutil getvcp 10 ;;
          up)  cur=$(ddcutil getvcp 10 2>/dev/null | grep -oP 'current value =\s*\K[0-9]+')
                 new=$((cur + 10))
                 [ "$new" -lt 0 ] && new=0
                 ddcutil setvcp 10 "$new" ;;
          down)  cur=$(ddcutil getvcp 10 2>/dev/null | grep -oP 'current value =\s*\K[0-9]+')
                 new=$((cur - 10))
                 [ "$new" -lt 0 ] && new=0
                 ddcutil setvcp 10 "$new" ;;
          *)     ddcutil setvcp 10 "$1" ;;
        esac
      '';
    };

    # ── NixOS system configuration ────────────────────
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix
        self.nixosModules.default    # → services.decky-loader.*
        {
          _module.args.inputs = inputs;
          nixpkgs.overlays = [ self.overlays.default ];  # → pkgs.decky-loader
        }
      ];
    };
  };
}
