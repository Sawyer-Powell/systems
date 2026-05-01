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
  # The function receives `inputs` and `system` from the caller.
  # `nixpkgs.lib.nixosSystem` builds a bootable NixOS closure.
  outputs = { self, nixpkgs, ... }@inputs: {
    nixosConfigurations.couchtop = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";

      # modules = the list of config files to merge together.
      # NixOS merges them all into one final system definition.
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix

        # Sneak brick through the window: expose the flake's
        # inputs to our modules. Configuration can then reference
        # things like `inputs.nixpkgs` — useful later for decky.
        {
          _module.args.inputs = inputs;
        }
      ];
    };
  };
}
