#!/usr/bin/env bash
# Typecheck this extension against the installed pi package. Usage: scripts/typecheck.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pi_bin="$(readlink -f "$(command -v pi)")"
pkg="$(cd "$(dirname "$pi_bin")/.." && pwd)/libexec/lib/node_modules/@earendil-works/pi-coding-agent"
[ -d "$pkg" ] || { echo "pi package not found at $pkg" >&2; exit 2; }
nm="$pkg/node_modules"
cfg="$(mktemp -t agents-tsconfig).json"
trap 'rm -f "$cfg"' EXIT
cat > "$cfg" <<JSON
{
  "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023"], "module": "ESNext", "moduleResolution": "Bundler",
    "baseUrl": "$nm",
    "paths": {
      "@earendil-works/pi-coding-agent": ["$pkg/dist/index.d.ts"],
      "@earendil-works/pi-tui": ["$nm/@earendil-works/pi-tui/dist/index.d.ts"],
      "typebox": ["$nm/typebox/build/index.d.mts"],
      "typebox/value": ["$nm/typebox/build/value/index.d.mts"]
    },
    "types": ["node"], "typeRoots": ["$nm/@types"],
    "allowImportingTsExtensions": true, "noEmit": true, "skipLibCheck": true, "strict": true
  },
  "include": ["$here/**/*.ts"]
}
JSON
exec npx -y -p typescript@5 tsc -p "$cfg"
