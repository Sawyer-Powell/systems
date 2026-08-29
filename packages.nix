{ self, nixpkgs, systems }:

let
  lib = nixpkgs.lib;
  forAllSystems = lib.genAttrs systems;
  pkgsFor = system: import nixpkgs {
    inherit system;
    config.allowUnfree = true;
  };
in
{
  packages = forAllSystems (system:
    let
      pkgs = pkgsFor system;
    in
    {
      # Build the pinned mont release from source for every managed platform.
      mont =
        let
          src = pkgs.fetchFromGitHub {
            owner = "Sawyer-Powell";
            repo = "mont";
            rev = "226fb177201210ec86a5724ef90aec0c4046c49d";
            hash = "sha256-T9yuySfbD9U6y2ddvr8GCP3RUGfGYVmGI8pcEkUnwSM=";
          };
        in
        pkgs.rustPlatform.buildRustPackage {
          pname = "mont";
          version = "0.3.1";
          inherit src;
          cargoLock.lockFile = "${src}/Cargo.lock";
        };
    }
    // lib.optionalAttrs (builtins.elem system [ "x86_64-linux" "aarch64-linux" ]) {
      polytoken = import ./custom_packages/polytoken.nix { inherit pkgs; };
    }
    // lib.optionalAttrs (system == "x86_64-linux") {
      syncthing-store-iso = self.nixosConfigurations.syncthing-store-installer.config.system.build.isoImage;
      brightness = pkgs.writeShellApplication {
        name = "brightness";
        runtimeInputs = with pkgs; [ ddcutil gnugrep ];
        text = builtins.readFile ./dotfiles/scripts/monitor-brightness;
      };
      eden = import ./custom_packages/eden-emulator.nix { inherit pkgs; };
    });

  apps = forAllSystems (system:
    let
      pkgs = pkgsFor system;
      tools = pkgs.rustPlatform.buildRustPackage {
        pname = "syncthing-store-tools";
        version = "0.1.0";
        src = ./infra/syncthing-store;
        cargoLock.lockFile = ./infra/syncthing-store/Cargo.lock;
        postPatch = ''
          substituteInPlace src/bootstrap.rs \
            --replace-fail '@nix@' '${pkgs.nix}/bin/nix' \
            --replace-fail '@repository@' '${self}' \
            --replace-fail '@ssh@' '${pkgs.openssh}/bin/ssh'
          substituteInPlace src/secrets.rs \
            --replace-fail '@op@' '${pkgs._1password-cli}/bin/op' \
            --replace-fail '@scp@' '${pkgs.openssh}/bin/scp' \
            --replace-fail '@ssh@' '${pkgs.openssh}/bin/ssh' \
            --replace-fail '@template@' '${./infra/syncthing-store/restic.env.tpl}'
        '';
      };
    in
    {
      syncthing-store-bootstrap = {
        type = "app";
        program = "${tools}/bin/syncthing-store-bootstrap";
      };
      syncthing-store-secrets = {
        type = "app";
        program = "${tools}/bin/syncthing-store-secrets";
      };
    }
    // lib.optionalAttrs (system == "x86_64-linux") {
      eden = {
        type = "app";
        program = "${self.packages.${system}.eden}/bin/eden";
      };
    });
}
