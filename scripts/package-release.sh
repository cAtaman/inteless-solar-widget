#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/dist"
artifact="Inteless-Solar.js"
source="$dist/$artifact"
version="$(node -p "require(process.argv[1]).version" "$root/package.json")"

if [[ ! -f "$source" ]]; then
  echo "Build the Scriptable artifact before packaging a release." >&2
  exit 1
fi

if command -v sha256sum >/dev/null; then
  sha256sum "$source" | sed "s|  $source$|  $artifact|" > "$dist/$artifact.sha256"
else
  shasum -a 256 "$source" | sed "s|  $source$|  $artifact|" > "$dist/$artifact.sha256"
fi

cat > "$dist/scriptable-gallery-submission.md" <<EOF
# Inteless Solar v$version

Title: Inteless Solar

Description: Read-only PV Inteless monitoring widget for Scriptable, iOS Home Screen, and Siri Shortcuts.

License: MIT

Installable script: $artifact

The Scriptable Gallery is curated and has no documented upload API. Submit this release asset through the Gallery's current contributor process; do not upload account data, screenshots, or credentials.
EOF

echo "Packaged dist/$artifact v$version"
