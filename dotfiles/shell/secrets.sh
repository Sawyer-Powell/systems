alias secrets=load-user-secrets

load-user-secrets() {
  local quiet ref
  quiet=0
  if [ "${1:-}" = "--quiet" ]; then
    quiet=1
  fi

  ref="${OP_EXA_API_KEY_REF:-}"
  if [ -z "$ref" ]; then
    ref="op://Personal/Exa AI/credential"
  fi

  if ! command -v op >/dev/null 2>&1; then
    echo "1Password CLI (op) is not available on PATH" >&2
    return 127
  fi

  EXA_API_KEY="$(op read "$ref")" || return $?
  export EXA_API_KEY

  case "$(uname -s)" in
    Linux)
      command -v systemctl >/dev/null 2>&1 && systemctl --user set-environment EXA_API_KEY="$EXA_API_KEY" >/dev/null 2>&1 || true
      command -v dbus-update-activation-environment >/dev/null 2>&1 && dbus-update-activation-environment --systemd EXA_API_KEY >/dev/null 2>&1 || true
      ;;
    Darwin)
      command -v launchctl >/dev/null 2>&1 && launchctl setenv EXA_API_KEY "$EXA_API_KEY" >/dev/null 2>&1 || true
      ;;
  esac

  if [ "$quiet" -ne 1 ]; then
    echo "Loaded EXA_API_KEY from 1Password into this shell."
  fi
}

# Disabled by default to avoid prompting/slowing every interactive shell.
# Run `load-user-secrets` (or `secrets`) when API-key-backed tools are needed.
if [ "${LOAD_USER_SECRETS_ON_SHELL:-0}" = "1" ] && [ -z "${EXA_API_KEY:-}" ]; then
  load-user-secrets --quiet || true
fi
