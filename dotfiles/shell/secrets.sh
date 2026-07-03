alias secrets=load-user-secrets

_load_user_secret_export() {
  local name value

  name="$1"
  value="$2"

  export "$name=$value"

  case "$(uname -s)" in
    Linux)
      command -v systemctl >/dev/null 2>&1 && \
        systemctl --user set-environment "$name=$value" >/dev/null 2>&1 || true

      command -v dbus-update-activation-environment >/dev/null 2>&1 && \
        dbus-update-activation-environment --systemd "$name" >/dev/null 2>&1 || true
      ;;
    Darwin)
      command -v launchctl >/dev/null 2>&1 && \
        launchctl setenv "$name" "$value" >/dev/null 2>&1 || true
      ;;
  esac
}

load-user-secrets() {
  local quiet config line name ref value loaded failed

  quiet=0
  loaded=0
  failed=0

  if [ "${1:-}" = "--quiet" ]; then
    quiet=1
  fi

  config="${USER_SECRETS_FILE:-$HOME/.config/shell/user-secrets.env}"

  if ! command -v op >/dev/null 2>&1; then
    echo "1Password CLI (op) is not available on PATH" >&2
    return 127
  fi

  if [ ! -f "$config" ]; then
    echo "Secrets config not found: $config" >&2
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac

    name="${line%%=*}"
    ref="${line#*=}"

    if [ -z "$name" ] || [ -z "$ref" ] || [ "$name" = "$ref" ]; then
      echo "Invalid secret line: $line" >&2
      failed=1
      continue
    fi

    value="$(op read "$ref")"
    if [ $? -ne 0 ]; then
      echo "Failed to read $name from 1Password ref: $ref" >&2
      failed=1
      continue
    fi

    _load_user_secret_export "$name" "$value"
    loaded=$((loaded + 1))
  done < "$config"

  if [ "$quiet" -ne 1 ]; then
    echo "Loaded $loaded secret(s) from 1Password into this shell."
  fi

  [ "$failed" -eq 0 ]
}

if [ "${LOAD_USER_SECRETS_ON_SHELL:-1}" = "1" ]; then
  load-user-secrets --quiet || true
fi
