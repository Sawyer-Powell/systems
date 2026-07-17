use std::{env, io, path::PathBuf, process::Command};

fn run(command: &mut Command) -> io::Result<()> {
    let status = command.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("command failed: {status}")))
    }
}

fn main() -> io::Result<()> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let (target, confirmed) = match arguments.as_slice() {
        [flag] if flag == "-h" || flag == "--help" => {
            println!("usage: syncthing-store-bootstrap [--yes] root@HOST");
            return Ok(());
        }
        [target] => (target.clone(), false),
        [flag, target] if flag == "--yes" => (target.clone(), true),
        _ => return Err(io::Error::other("usage: syncthing-store-bootstrap [--yes] root@HOST")),
    };

    run(Command::new("@ssh@").args([&target, "lsblk", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS"]))?;

    if !confirmed {
        println!("This erases /dev/vda and /dev/vdb on {target}. Type ERASE:");
        let mut confirmation = String::new();
        io::stdin().read_line(&mut confirmation)?;
        if confirmation.trim() != "ERASE" {
            return Err(io::Error::other("aborted"));
        }
    }

    let repository = PathBuf::from("@repository@");
    run(Command::new("@nix@").args([
        "run",
        "github:nix-community/nixos-anywhere",
        "--",
        "--phases",
        "disko,install,reboot",
        "--flake",
        &format!("{}#syncthing-store", repository.display()),
        "--target-host",
        &target,
    ]))
}
