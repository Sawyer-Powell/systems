{ ... }:

{
  imports = [
    ../../darwin.nix
  ];

  networking.hostName = "personal-macbook";

  # Personal GUI applications. The shared Darwin module only enables Homebrew
  # so other hosts can intentionally choose a smaller set.
  homebrew.casks = [
    "1password"
    "docker-desktop"
    "firefox"
    "ghostty"
    "gimp"
    "prismlauncher"
    "zed"
  ];
}
