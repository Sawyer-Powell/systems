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
    lib.optionalAttrs (builtins.elem system [ "x86_64-linux" "aarch64-linux" ]) {
      polytoken = import ./custom_packages/polytoken.nix { inherit pkgs; };
    }
    // lib.optionalAttrs (system == "x86_64-linux") {
      brightness = pkgs.writeShellApplication {
        name = "brightness";
        runtimeInputs = with pkgs; [ ddcutil gnugrep ];
        text = builtins.readFile ./dotfiles/scripts/monitor-brightness;
      };
      eden = import ./custom_packages/eden-emulator.nix { inherit pkgs; };
    });

  apps = forAllSystems (system:
    lib.optionalAttrs (system == "x86_64-linux") {
      eden = {
        type = "app";
        program = "${self.packages.${system}.eden}/bin/eden";
      };
    });
}
