{
  description = "couchtop — gaming console NixOS";

  # ── Inputs: where do my dependencies come from? ─────
  # Each input is fetched, its exact commit locked in flake.lock.
  # "github:owner/repo/branch" means "follow this branch"
  # But flake.lock pins the *exact commit* — so it's reproducible.
  inputs = {
    # nixpkgs — the giant package repository (80,000+ packages)
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  # ── Outputs: what does this flake produce? ──────────
  outputs = { self, nixpkgs, ... }@inputs:
  let
    # Helper: make pkgs for each system our flake supports.
    # eachSystem calls our function once per system (x86_64-linux, aarch64-linux...)
    eachSystem = nixpkgs.lib.genAttrs [ "x86_64-linux" ];
  in
  {
    # ── Packages ────────────────────────────────────
    # These are things we can build with `nix build .#<name>`
    packages = eachSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        # A script is a package too. writeShellScriptBin produces
        # a derivation that puts the script in /bin/<name>.
        brightness = pkgs.writeShellScriptBin "brightness" ''
          set -e
          # VCP code 0x10 = brightness. ddcutil talks DDC/CI to the monitor.
          case "''${1:-show}" in
            show)  ddcutil getvcp 10 ;;
            up)    ddcutil setvcp 10 +10 ;;
            down)  ddcutil setvcp 10 -10 ;;
            *)     ddcutil setvcp 10 "$1" ;;
          esac
        '';
      });

    # ── NixOS configurations ────────────────────────
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";

      modules = [
        ./configuration.nix
        ./hardware-configuration.nix

        # Make our packages available in configuration.nix
        # as `inputs.self.packages`.
        {
          _module.args.inputs = inputs;
        }
      ];
    };
  };
}
