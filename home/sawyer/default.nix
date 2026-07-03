{ config, pkgs, lib, inputs, homeDirectory, dotfilesPath, ... }:

{
  imports = [
    ./secrets.nix
  ];

  home.username = "sawyer";
  home.homeDirectory = homeDirectory;

  # ── Packages shared across Linux/macOS where available ─
  home.packages = with pkgs; [
    zellij
    btop
    ripgrep
    fd
    jq
    gh
    git
    _1password-cli
    jjui
    jujutsu
    uv
    neovim
    tree-sitter

    # Generic native build tooling for editor plugins and local development.
    gcc
    gnumake
    pkg-config
    cmake
    ninja

    zsh
  ] ++ lib.optionals pkgs.stdenv.isLinux [
    gimp
    firefox
    _1password-gui
    inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.polytoken
  ];

  # ── SSH / signing identity ─────────────────────────
  # 1Password is the source of truth for private SSH keys. The same SSH key is
  # used for Git commit/tag signing via 1Password's op-ssh-sign helper.
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    SSH_AUTH_SOCK = if pkgs.stdenv.isDarwin then
      "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
    else
      "$HOME/.1password/agent.sock";
  };

  programs.ssh = {
    enable = true;
    extraConfig = ''
      IdentityAgent ${if pkgs.stdenv.isDarwin then "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" else "~/.1password/agent.sock"}
    '';
  };

  # Let the 1Password SSH agent offer keys from the Personal vault. The private
  # keys themselves stay in 1Password, not in this repository or ~/.ssh.
  xdg.configFile."1Password/ssh/agent.toml".text = ''
    [[ssh-keys]]
    vault = "Personal"
  '';

  # ── Git ─────────────────────────────────────────────
  programs.git = {
    enable = true;
    settings = {
      user.name = "Sawyer Powell";
      user.email = "sawyerhpowell@gmail.com";

      gpg.format = "ssh";
      gpg.ssh.program = "op-ssh-sign";
      user.signingkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF1AbbXZzfx3O4xtwBzMSGetMEy9AfLRHwdN339qE2gq id_ed25519";
      commit.gpgsign = true;
      tag.gpgsign = true;

      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
    };
  };

  # ── Shells ──────────────────────────────────────────
  programs.bash = {
    enable = true;
    initExtra = ''
      # 1Password owns SSH keys and Git SSH signing.
      export SSH_AUTH_SOCK="${if pkgs.stdenv.isDarwin then "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" else "$HOME/.1password/agent.sock"}"

      alias vim=nvim
      alias vi=nvim
      source "$HOME/.config/shell/secrets.sh"
    '';
  };

  home.file.".zshrc" = {
    force = true;
    text = ''
      # 1Password owns SSH keys and Git SSH signing.
      export SSH_AUTH_SOCK="${if pkgs.stdenv.isDarwin then "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" else "$HOME/.1password/agent.sock"}"

      alias vim=nvim
      alias vi=nvim
      source "$HOME/.config/shell/secrets.sh"
    '';
  };

  # ── Shared dotfiles ─────────────────────────────────
  xdg.configFile."polytoken/config.yaml" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/polytoken/config.yaml";
    force = true;
  };

  xdg.configFile."nvim" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/nvim";
    force = true;
  };

  xdg.configFile."zellij" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/zellij";
    force = true;
  };

  xdg.configFile."ghostty" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/ghostty";
    force = true;
  };

  xdg.configFile."zed/settings.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/zed/settings.json";
    force = true;
  };

  xdg.configFile."zed/keymap.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/zed/keymap.json";
    force = true;
  };

  xdg.configFile."zed/tasks.json" = {
    source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/zed/tasks.json";
    force = true;
  };

  # Let Home Manager manage itself.
  programs.home-manager.enable = true;

  home.stateVersion = "25.11";
}
