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
    disko = {
      url = "github:nix-community/disko";
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
            username = "sawyer";
            userHome = "/home/sawyer";
            dotfilesDir = "/home/sawyer/nixos-config/dotfiles";
            isPersonal = true;
          };
          home-manager.users.sawyer.imports = [
            ./home/sawyer
            ./home/sawyer/linux.nix
          ];
        }
      ];
    };

    # Cheap HDD-backed, always-online Syncthing replica. Initial installation
    # is performed with nixos-anywhere; subsequent changes use nixos-rebuild.
    nixosConfigurations.syncthing-store = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };
      modules = [
        inputs.disko.nixosModules.disko
        ./hosts/syncthing-store
      ];
    };
    nixosConfigurations.syncthing-store-installer = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [ ./hosts/syncthing-store/installer.nix ];
    };

    # ── macOS systems ─────────────────────────────────
    darwinConfigurations.personal-macbook = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      specialArgs = {
        inherit inputs;
        username = "sawyer";
        userHome = "/Users/sawyer";
      };
      modules = [
        ./hosts/personal-macbook
        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "hm-backup";
          home-manager.extraSpecialArgs = {
            inherit inputs;
            username = "sawyer";
            userHome = "/Users/sawyer";
            dotfilesDir = "/Users/sawyer/repos/systems/dotfiles";
            systemsDir = "/Users/sawyer/repos/systems";
            systemConfigName = "personal-macbook";
            isPersonal = true;
          };
          home-manager.users.sawyer.imports = [
            ./home/sawyer
            ./home/sawyer/darwin.nix
          ];
        }
      ];
    };

    # A deliberately minimal work profile: shared development tools and
    # dotfiles, without personal identity, signing, secrets, or synchronization.
    darwinConfigurations.work-macbook = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      specialArgs = {
        inherit inputs;
        username = "sawyerpowell";
        userHome = "/Users/sawyerpowell";
      };
      modules = [
        ./hosts/work-macbook
        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "hm-backup";
          home-manager.extraSpecialArgs = {
            inherit inputs;
            username = "sawyerpowell";
            userHome = "/Users/sawyerpowell";
            dotfilesDir = "/Users/sawyerpowell/repos/systems/dotfiles";
            systemsDir = "/Users/sawyerpowell/repos/systems";
            systemConfigName = "work-macbook";
            isPersonal = false;
          };
          home-manager.users.sawyerpowell.imports = [
            ./home/sawyer
            ./home/sawyer/darwin.nix
          ];
        }
      ];
    };
  };
}
