{
  description = "couchtop — gaming console NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, home-manager, ... }@inputs:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
  in
  {
    # ── Packages ────────────────────────────────────
    packages.${system} = {
      brightness = pkgs.writeShellScriptBin "brightness" ''
        set -e
        case "''${1:-show}" in
          show)  ddcutil getvcp 10 ;;
          up)    cur=$(ddcutil getvcp 10 2>/dev/null | grep -oP 'current value =\s*\K[0-9]+')
                 new=$((cur + 10))
                 [ "$new" -gt 100 ] && new=100
                 ddcutil setvcp 10 "$new" ;;
          down)  cur=$(ddcutil getvcp 10 2>/dev/null | grep -oP 'current value =\s*\K[0-9]+')
                 new=$((cur - 10))
                 [ "$new" -lt 0 ] && new=0
                 ddcutil setvcp 10 "$new" ;;
          *)     ddcutil setvcp 10 "$1" ;;
        esac
      '';
      pi = import ./pi.nix { inherit pkgs; };
      eden = import ./eden-emulator.nix { inherit pkgs; };
      polytoken = import ./polytoken.nix { inherit pkgs; };
    };

    # ── Apps (runnable via `nix run .#eden`) ─────────
    apps.${system} = {
      eden = {
        type = "app";
        program = "${self.packages.${system}.eden}/bin/eden";
      };
    };

    # ── NixOS system configuration ──────────────────
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix
        { _module.args.inputs = inputs; }

        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.sawyer = import ./home.nix;
        }
      ];
    };
  };
}
