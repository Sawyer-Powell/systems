# nixos-config

This repository is the canonical source of truth for Sawyer's NixOS system configuration and user dotfiles.

## Host rebuild flow

Build the current host without activating it:

```bash
sudo nixos-rebuild build --flake .#couchtop
```

Activate only when you are ready to switch the running system:

```bash
sudo nixos-rebuild switch --flake .#couchtop
```

Polytoken and Home Manager are integrated through the NixOS flake. There is no separate standalone Home Manager flake output at the moment.

## Dotfiles

Raw app configuration lives under `dotfiles/` and is linked by Home Manager with `xdg.configFile`:

- `dotfiles/nvim` -> `~/.config/nvim`
- `dotfiles/ghostty` -> `~/.config/ghostty`
- `dotfiles/zellij` -> `~/.config/zellij`
- selected files from `dotfiles/zed` -> `~/.config/zed/`
- `dotfiles/shell/secrets.sh` -> `~/.config/shell/secrets.sh`
- reusable helper scripts in `dotfiles/scripts/`, packaged from Nix where needed

The abandoned `pi` agent content is intentionally not installed, and Neovim's old `pi-ipc` integration is intentionally omitted.

## Secrets

1Password is the source of truth for user secrets. Plaintext secret values must not be committed, embedded in Nix expressions, placed in Home Manager `sessionVariables`, or written to tracked dotfiles.

The interactive shell defines:

```bash
load-user-secrets
```

It reads the Exa API key with `op read`, exports `EXA_API_KEY` into the current shell, and attempts to sync it into the Linux user-session environment for processes started later from systemd/dbus activation. Run `load-user-secrets` manually in the shell before launching API-key-backed tools such as `polytoken` or `nvim`. If you later want eager loading for a shell, opt in with `LOAD_USER_SECRETS_ON_SHELL=1` before sourcing the shell startup files.

Default 1Password reference:

```text
op://Personal/Exa AI/credential
```

If the item, vault, or field name differs, set `OP_EXA_API_KEY_REF` before running the loader, for example:

```bash
export OP_EXA_API_KEY_REF='op://Personal/Exa AI/credential'
load-user-secrets
```

Authenticate the 1Password CLI first if needed:

```bash
op account list
# or follow the 1Password CLI sign-in flow for this machine
```

Do not paste secret values into logs or issue trackers. To validate without printing the key:

```bash
[ -n "$EXA_API_KEY" ] && echo 'EXA_API_KEY present'
systemctl --user show-environment | grep -q '^EXA_API_KEY=' && echo 'EXA_API_KEY present in user manager'
```
