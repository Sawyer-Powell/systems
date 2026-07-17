use std::{env, fs, io, os::unix::fs::PermissionsExt, path::Path, process::Command};

const SECRETS_DIR: &str = "/var/lib/syncthing-store-secrets";
const PASSWORD_REF: &str = "op://Infrastructure/syncthing-store/RESTIC_PASSWORD";

fn run(command: &mut Command) -> io::Result<()> {
    let status = command.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("command failed: {status}")))
    }
}

fn main() -> io::Result<()> {
    let target = match env::args().nth(1).as_deref() {
        Some("-h" | "--help") | None => {
            println!("usage: syncthing-store-secrets root@HOST");
            return Ok(());
        }
        Some(target) => target.to_owned(),
    };

    let temporary = env::temp_dir().join(format!("syncthing-store-{}", std::process::id()));
    fs::create_dir(&temporary)?;
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700))?;
    let result = deploy(&target, &temporary);
    let cleanup = fs::remove_dir_all(&temporary);
    result.and(cleanup)
}

fn deploy(target: &str, temporary: &Path) -> io::Result<()> {
    let environment = temporary.join("restic.env");
    let password = temporary.join("restic-password");

    run(Command::new("@op@").args([
        "inject",
        "-i",
        "@template@",
        "-o",
        environment.to_str().unwrap(),
        "--file-mode",
        "0600",
    ]))?;

    let output = Command::new("@op@").args(["read", PASSWORD_REF]).output()?;
    if !output.status.success() {
        return Err(io::Error::other("op read failed"));
    }
    fs::write(&password, output.stdout)?;
    fs::set_permissions(&password, fs::Permissions::from_mode(0o600))?;

    run(Command::new("@ssh@").args([target, "install", "-d", "-m", "0700", SECRETS_DIR]))?;
    run(Command::new("@scp@").args([
        "-q",
        environment.to_str().unwrap(),
        password.to_str().unwrap(),
        &format!("{target}:{SECRETS_DIR}/"),
    ]))?;
    run(Command::new("@ssh@").args([
        target,
        "chmod",
        "0600",
        &format!("{SECRETS_DIR}/restic.env"),
        &format!("{SECRETS_DIR}/restic-password"),
    ]))?;
    run(Command::new("@ssh@").args([
        target,
        "systemctl",
        "start",
        "restic-backups-syncthing-store",
    ]))
}
