#!/usr/bin/env bash
# Run unit tests: scripts/test.sh [files...]  (default: every *.test.ts)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
files=("$@")
[ ${#files[@]} -eq 0 ] && while IFS= read -r f; do files+=("$f"); done < <(find . -name '*.test.ts' -not -path './node_modules/*' | sort)
exec node --experimental-strip-types --import ./scripts/register.mjs --test "${files[@]}"
