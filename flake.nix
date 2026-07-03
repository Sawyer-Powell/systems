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
      brightness = pkgs.writeShellApplication {
        name = "brightness";
        runtimeInputs = with pkgs; [ ddcutil gnugrep ];
        text = builtins.readFile ./dotfiles/scripts/monitor-brightness;
      };
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
