#!/usr/bin/env bash
set -euo pipefail

tag="${1:?Pass the release tag.}"

if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" dist/* --clobber
else
  gh release create "$tag" dist/* --title "$tag" --generate-notes
fi
