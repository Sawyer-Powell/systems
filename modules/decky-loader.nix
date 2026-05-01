# NixOS module for Decky Loader
# Enables the Steam Deck plugin loader as a systemd service.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.decky-loader;
in
{
  options.services.decky-loader = {
    enable = lib.mkEnableOption "Steam Deck Plugin Loader (decky)";

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/decky-loader";
      description = "Directory for plugins and decky state.";
    };

    steamUser = lib.mkOption {
      type = lib.types.str;
      default = "sawyer";
      description = "The Linux user that runs Steam.";
    };
  };

  config = lib.mkIf cfg.enable {
    # ── Decky user for plugin sandboxing ───────────────
    users.users.decky = {
      group = "decky";
      home = cfg.stateDir;
      isSystemUser = true;
    };
    users.groups.decky = { };

    # ── systemd service ────────────────────────────────
    # Runs as root (required by decky for setuid), but
    # plugins run as the unprivileged "decky" user.
    systemd.services.decky-loader = {
      description = "Steam Deck Plugin Loader";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        UNPRIVILEGED_USER = "decky";
        UNPRIVILEGED_PATH = cfg.stateDir;
        PLUGIN_PATH = "${cfg.stateDir}/plugins";
      };

      preStart = ''
        mkdir -p "${cfg.stateDir}" "${cfg.stateDir}/plugins"
        chown -R decky:decky "${cfg.stateDir}"
        # Steam's CEF needs remote debugging enabled for decky to inject
        mkdir -p "/home/${cfg.steamUser}/.steam/steam"
        touch "/home/${cfg.steamUser}/.steam/steam/.cef-enable-remote-debugging"
        chown -R "${cfg.steamUser}:users" "/home/${cfg.steamUser}/.steam"
      '';

      serviceConfig = {
        ExecStart = "${pkgs.decky-loader}/bin/decky-loader";
        KillMode = "process";
        TimeoutStopSec = 45;
      };
    };
  };
}
