#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/dist"
artifact="Inteless-Solar.js"
source="$dist/$artifact"

if [[ ! -f "$source" ]]; then
  echo "Build the Scriptable artifact before packaging a release." >&2
  exit 1
fi

cp "$root/README.md" "$dist/README.md"

if command -v sha256sum >/dev/null; then
  sha256sum "$source" | sed "s|  $source$|  $artifact|" > "$dist/$artifact.sha256"
else
  shasum -a 256 "$source" | sed "s|  $source$|  $artifact|" > "$dist/$artifact.sha256"
fi

echo "Packaged dist/$artifact"
