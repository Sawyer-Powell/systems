{ lib, ... }:

{
  # HostHatch Storage VMs expose a small system disk and a large HDD.
  disko.devices.disk = {
    system = {
      type = "disk";
      device = lib.mkDefault "/dev/vda";
      content = {
        type = "gpt";
        partitions = {
          bios = {
            size = "1M";
            type = "EF02";
          };
          swap = {
            size = "2G";
            content = {
              type = "swap";
              randomEncryption = true;
            };
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
              mountOptions = [ "noatime" ];
            };
          };
        };
      };
    };
    data = {
      type = "disk";
      device = lib.mkDefault "/dev/vdb";
      content = {
        type = "gpt";
        partitions.data = {
          size = "100%";
          content = {
            type = "filesystem";
            format = "ext4";
            mountpoint = "/srv/syncthing";
            mountOptions = [ "noatime" ];
          };
        };
      };
    };
  };
}
