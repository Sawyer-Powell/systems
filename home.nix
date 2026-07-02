{ config, pkgs, lib, ... }:

let
  polytoken = import ./polytoken.nix { inherit pkgs; };
  monitorBrightness = pkgs.writeShellScriptBin "monitor-brightness" ''
    set -e

    ddcutil=${pkgs.ddcutil}/bin/ddcutil
    grep=${pkgs.gnugrep}/bin/grep

    case "''${1:-show}" in
      show)  "$ddcutil" getvcp 10 ;;
      up)    cur=$("$ddcutil" getvcp 10 2>/dev/null | "$grep" -oP 'current value =\s*\K[0-9]+')
             new=$((cur + 10))
             [ "$new" -gt 100 ] && new=100
             "$ddcutil" setvcp 10 "$new" ;;
      down)  cur=$("$ddcutil" getvcp 10 2>/dev/null | "$grep" -oP 'current value =\s*\K[0-9]+')
             new=$((cur - 10))
             [ "$new" -lt 0 ] && new=0
             "$ddcutil" setvcp 10 "$new" ;;
      *)     "$ddcutil" setvcp 10 "$1" ;;
    esac
  '';

  niriWindowSwitcher = pkgs.writeShellScriptBin "niri-window-switcher" ''
    set -euo pipefail

    choice=$(
      ${pkgs.niri}/bin/niri msg -j windows \
        | ${pkgs.jq}/bin/jq -r '.[] | "\(.id)  \(.app_id // "unknown") — \(.title // "")"' \
        | ${pkgs.fuzzel}/bin/fuzzel --dmenu --prompt 'Window: '
    ) || exit 0

    [ -n "$choice" ] || exit 0
    id="''${choice%% *}"
    ${pkgs.niri}/bin/niri msg action focus-window --id "$id"
  '';
in
{
  home.username = "sawyer";
  home.homeDirectory = "/home/sawyer";

  # ── Packages just for your user ─────────────────────
  home.packages = with pkgs; [
    gimp
    zellij
    btop
    ripgrep
    qbittorrent
    fd
    mullvad
    jq
    gh
    git
    bitwarden-cli
    jjui
    jujutsu
    uv
    firefox
    ghostty
    fuzzel
    neovim
    polytoken
  ];

  # ── Git ─────────────────────────────────────────────
  programs.git = {
    enable = true;

    # Modern settings style (replaces userName/userEmail/extraConfig)
    settings = {
      user.name = "Sawyer Powell";
      user.email = "sawyerhpowell@gmail.com";

      user.signingkey = "3A3CA3284DF8431A";
      commit.gpgsign = true;
      tag.gpgsign = true;

      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
    };
  };

  # ── Neovim as default editor everywhere ─────────────
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
  };

  programs.bash = {
    enable = true;
    initExtra = ''
      alias vim=nvim
      alias vi=nvim
      alias switch="sudo nixos-rebuild switch --flake ."
    '';
  };

  # ── Ghostty ──────────────────────────────────────────
  xdg.configFile."ghostty/config".text = ''
    window-padding-x = 0
    window-padding-y = 0
    window-padding-balance = true
    window-decoration = false
  '';

  # Minimal niri config with absolute Nix store paths for core launchers.
  # This avoids depending on the PATH that niri/systemd happens to inherit.
  xdg.configFile."niri/config.kdl" = {
    # Replace the stock/example config that niri created as a regular file.
    # Without force, Home Manager will not take ownership of an existing file.
    force = true;
    text = ''
      input {
          keyboard {
              xkb {
                  layout "us"
              }
          }

          touchpad {
              natural-scroll
          }
      }

      output "LG Electronics LG ULTRAGEAR+ 408NTTQ8J449" {
          scale 1.5
      }

      // Dark Gruvbox-inspired Niri visuals.
      layout {
          background-color "#1d2021"

          focus-ring {
              on
              width 3
              active-color "#fe8019"
              inactive-color "#282828"
              urgent-color "#fb4934"
          }

          border {
              off
              width 2
              active-color "#d79921"
              inactive-color "#3c3836"
              urgent-color "#fb4934"
          }

          shadow {
              on
              softness 30
              spread 5
              offset x=0 y=5
              color "#00000070"
              inactive-color "#00000040"
          }
      }

      binds {
          Mod+T hotkey-overlay-title="Open Terminal: Ghostty" { spawn "${pkgs.ghostty}/bin/ghostty"; }
          Mod+D hotkey-overlay-title="Open App Launcher: fuzzel" { spawn "${pkgs.fuzzel}/bin/fuzzel"; }
          Mod+Space hotkey-overlay-title="Switch Windows: fuzzel" { spawn "${niriWindowSwitcher}/bin/niri-window-switcher"; }
          Mod+B hotkey-overlay-title="Open Browser: Firefox" { spawn "${pkgs.firefox}/bin/firefox"; }
          Mod+Ctrl+B hotkey-overlay-title="Open Bluetooth Manager: Blueman" { spawn "${pkgs.blueman}/bin/blueman-manager"; }
          Mod+Shift+Slash hotkey-overlay-title="Show Hotkey Overlay" { show-hotkey-overlay; }
          Mod+O hotkey-overlay-title="Toggle Overview" { toggle-overview; }

          XF86AudioRaiseVolume allow-when-locked=true { spawn "${pkgs.wireplumber}/bin/wpctl" "set-volume" "@DEFAULT_AUDIO_SINK@" "0.05+" "-l" "1.0"; }
          XF86AudioLowerVolume allow-when-locked=true { spawn "${pkgs.wireplumber}/bin/wpctl" "set-volume" "@DEFAULT_AUDIO_SINK@" "0.05-"; }
          XF86AudioMute allow-when-locked=true { spawn "${pkgs.wireplumber}/bin/wpctl" "set-mute" "@DEFAULT_AUDIO_SINK@" "toggle"; }
          XF86AudioMicMute allow-when-locked=true { spawn "${pkgs.wireplumber}/bin/wpctl" "set-mute" "@DEFAULT_AUDIO_SOURCE@" "toggle"; }

          XF86AudioPlay allow-when-locked=true { spawn "${pkgs.playerctl}/bin/playerctl" "play-pause"; }
          XF86AudioPause allow-when-locked=true { spawn "${pkgs.playerctl}/bin/playerctl" "play-pause"; }
          XF86AudioStop allow-when-locked=true { spawn "${pkgs.playerctl}/bin/playerctl" "stop"; }
          XF86AudioPrev allow-when-locked=true { spawn "${pkgs.playerctl}/bin/playerctl" "previous"; }
          XF86AudioNext allow-when-locked=true { spawn "${pkgs.playerctl}/bin/playerctl" "next"; }

          XF86MonBrightnessUp allow-when-locked=true { spawn "${monitorBrightness}/bin/monitor-brightness" "up"; }
          XF86MonBrightnessDown allow-when-locked=true { spawn "${monitorBrightness}/bin/monitor-brightness" "down"; }

          Mod+Q { close-window; }
          Mod+Shift+E { quit; }

          Mod+Left  { focus-column-left; }
          Mod+Down  { focus-window-down; }
          Mod+Up    { focus-window-up; }
          Mod+Right { focus-column-right; }

          Mod+H { focus-column-left; }
          Mod+J { focus-workspace-down; }
          Mod+K { focus-workspace-up; }
          Mod+L { focus-column-right; }

          Mod+Shift+Left  { move-column-left; }
          Mod+Shift+Down  { move-window-down; }
          Mod+Shift+Up    { move-window-up; }
          Mod+Shift+Right { move-column-right; }

          Mod+Shift+H { move-column-left; }
          Mod+Shift+J { move-window-to-workspace-down; }
          Mod+Shift+K { move-window-to-workspace-up; }
          Mod+Shift+L { move-column-right; }

          Mod+F { maximize-column; }
          Mod+Shift+F { fullscreen-window; }
          Mod+V { toggle-window-floating; }
          Mod+Shift+V { switch-focus-between-floating-and-tiling; }
      }
    '';
  };

  # Steam is installed, but do not auto-launch it while the niri session and
  # xwayland-satellite setup are being stabilized. Steam may create XDG
  # autostart entries itself, so remove the common variants on activation.
  home.activation.disableSteamAutostart = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    rm -f \
      "$HOME/.config/autostart/steam.desktop" \
      "$HOME/.config/autostart/Steam.desktop" \
      "$HOME/.config/autostart/steam"*.desktop \
      "$HOME/.config/autostart/Steam"*.desktop
  '';

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  home.stateVersion = "25.11";
}
