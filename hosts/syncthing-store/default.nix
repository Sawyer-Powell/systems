{ lib, ... }:

let
  resticSecrets = "/var/lib/syncthing-store-secrets";
in
{
  imports = [ ./disk-config.nix ];

  networking = {
    hostName = "syncthing-store";
    useDHCP = lib.mkDefault true;
    firewall = {
      allowedTCPPorts = [ 22 22000 ];
      allowedUDPPorts = [ 22000 ];
    };
  };

  boot.initrd.availableKernelModules = [ "virtio_blk" "virtio_pci" "virtio_scsi" ];
  boot.loader.grub.enable = true;

  nix = {
    settings.experimental-features = [ "nix-command" "flakes" ];
    gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 14d";
    };
  };

  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGaDe/QoajHR6CMl2DdVPtHyXCs5LuL3w8RBwi4xPquV sawyer@Sawyers-MacBook-Pro.local"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF1AbbXZzfx3O4xtwBzMSGetMEy9AfLRHwdN339qE2gq id_ed25519"
  ];
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };

  services.syncthing = {
    enable = true;
    guiAddress = "127.0.0.1:8384";
    overrideDevices = false;
    overrideFolders = false;
    settings = {
      options = {
        localAnnounceEnabled = false;
        urAccepted = -1;
      };
      folders.shared.path = "/srv/syncthing/shared";
    };
  };
  systemd.tmpfiles.rules = [
    "d /srv/syncthing/shared 0750 syncthing syncthing - -"
  ];
  systemd.services.syncthing = {
    requires = [ "srv-syncthing.mount" ];
    after = [ "srv-syncthing.mount" ];
  };

  services.restic.backups.syncthing-store = {
    initialize = true;
    paths = [ "/srv/syncthing" "/var/lib/syncthing/.config/syncthing" ];
    environmentFile = "${resticSecrets}/restic.env";
    passwordFile = "${resticSecrets}/restic-password";
    pruneOpts = [ "--keep-daily 14" "--keep-weekly 8" "--keep-monthly 12" ];
    checkOpts = [ "--read-data-subset=5%" ];
    timerConfig = {
      OnCalendar = "daily";
      Persistent = true;
      RandomizedDelaySec = "1h";
    };
  };
  systemd.services.restic-backups-syncthing-store.unitConfig.ConditionPathExists = [
    "${resticSecrets}/restic.env"
    "${resticSecrets}/restic-password"
  ];

  system.stateVersion = "25.11";
}
