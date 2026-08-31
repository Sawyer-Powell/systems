{ ... }:

{
  imports = [
    ../../darwin.nix
  ];

  networking.hostName = "work-macbook";

  # Keep work-managed GUI software minimal. Developer CLI tools and dotfiles
  # come from Home Manager; personal apps and 1Password are intentionally absent.
  homebrew.casks = [
    "ghostty"
  ];
}
