# Syncthing storage server

A cheap HDD-backed NixOS VM is the always-online Syncthing replica. Restic sends daily encrypted backups to an independent Backblaze B2 bucket. Syncthing propagates deletions; B2 is the recovery copy.

## 1Password and B2

Create a private B2 bucket without default Object Lock initially. Create a **Read and Write** application key restricted to that bucket; do not use the master key.

Create an item named `syncthing-store` in the `Infrastructure` vault with these fields:

| Field | Value |
| --- | --- |
| `RESTIC_REPOSITORY` | `s3:s3.<B2-region>.backblazeb2.com/<bucket>` |
| `RESTIC_PASSWORD` | generated password, at least 32 characters |
| `AWS_ACCESS_KEY_ID` | B2 application key ID |
| `AWS_SECRET_ACCESS_KEY` | B2 application key |

The field names and vault/item names must match `restic.env.tpl` and `src/secrets.rs`. Unlock 1Password and enable **Settings → Developer → Integrate with 1Password CLI** before deployment. Losing `RESTIC_PASSWORD` makes the backup unrecoverable.

## Install

Create a HostHatch x86_64 Storage VM with a stock Linux image and your SSH public key. Confirm the system disk is `/dev/vda` and the approximately 1 TB storage disk is `/dev/vdb`:

```console
ssh root@HOST lsblk
```

Build `.#syncthing-store-iso`, upload the ISO from `result/iso/` to HostHatch, attach it, and boot the VM from virtual CD. Once `ssh root@HOST` reaches `syncthing-store-installer`, install NixOS and backup credentials:

```console
nix build .#syncthing-store-iso
nix run .#syncthing-store-bootstrap -- root@HOST
nix run .#syncthing-store-secrets -- root@HOST
```

The second command reads 1Password locally, installs root-only runtime files, initializes Restic, and waits for the first backup.

Pair Syncthing through an SSH tunnel; its GUI is not public:

```console
ssh -N -L 8384:127.0.0.1:8384 root@HOST
```

Open <http://127.0.0.1:8384>. Device IDs are not secrets. They can remain GUI-managed until moved into the Nix configuration.

## Operate

```console
# Deploy configuration
nixos-rebuild switch --flake .#syncthing-store \
  --target-host root@HOST --build-host localhost

# Inspect health
ssh root@HOST 'systemctl --failed; systemctl list-timers restic-backups-syncthing-store.timer'
ssh root@HOST restic-syncthing-store snapshots
ssh root@HOST df -h /
```

Restic runs daily and retains 14 daily, 8 weekly, and 12 monthly snapshots. Test a restore quarterly.

## Restore a replacement

Bootstrap a new VM, deploy its secrets, then restore before pairing/starting synchronization:

```console
ssh root@HOST
systemctl stop syncthing
restic-syncthing-store restore latest --target /tmp/restore
cp -a /tmp/restore/srv/syncthing/. /srv/syncthing/
cp -a /tmp/restore/var/lib/syncthing/.config/syncthing/. /var/lib/syncthing/.config/syncthing/
chown -R syncthing:syncthing /srv/syncthing /var/lib/syncthing
systemctl start syncthing
```

The warm VM stores plaintext. Syncthing transport and B2 backups are encrypted. HostHatch provisioning and this destructive bootstrap still need validation on the first real VM.
