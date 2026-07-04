{
  description = "Sawyer's NixOS and macOS systems";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, home-manager, nix-darwin, ... }@inputs:
  let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];

    packageOutputs = import ./packages.nix {
      inherit self nixpkgs systems;
    };
  in
  packageOutputs
  // {
    # ── NixOS systems ─────────────────────────────────
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };
      modules = [
        ./hosts/couchtop

        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "hm-backup";
          home-manager.extraSpecialArgs = {
            inherit inputs;
            userHome = "/home/sawyer";
            dotfilesDir = "/home/sawyer/nixos-config/dotfiles";
          };
          home-manager.users.sawyer.imports = [
            ./home/sawyer
            ./home/sawyer/linux.nix
          ];
        }
      ];
    };

    # ── macOS systems ─────────────────────────────────
    darwinConfigurations.macbook = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      specialArgs = { inherit inputs; };
      modules = [
        ./darwin.nix
        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "hm-backup";
          home-manager.extraSpecialArgs = {
            inherit inputs;
            userHome = "/Users/sawyer";
            dotfilesDir = "/Users/sawyer/repos/systems/dotfiles";
          };
          home-manager.users.sawyer.imports = [
            ./home/sawyer
            ./home/sawyer/darwin.nix
          ];
        }
      ];
    };
  };
}
