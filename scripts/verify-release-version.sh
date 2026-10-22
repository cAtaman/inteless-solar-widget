#!/usr/bin/env bash
set -euo pipefail

tag="${1:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require(process.argv[1]).version" "$root/package.json")"

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Expected a semantic release tag, received ${tag:-'(missing)'}." >&2
  exit 1
fi

if [[ "$tag" != "v$version" ]]; then
  echo "Release tag $tag does not match package.json version v$version." >&2
  exit 1
fi

echo "Release tag $tag matches package version $version."
