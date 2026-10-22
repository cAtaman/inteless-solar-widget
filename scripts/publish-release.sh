#!/usr/bin/env bash
set -euo pipefail

tag="${1:?Pass the release tag.}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required.}"
notes_file="$(mktemp)"
trap 'rm -f "$notes_file"' EXIT

previous_tag="$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)"
if [[ -n "$previous_tag" ]]; then
  {
    printf '## Changes\n\n'
    git log --format='%s' "$previous_tag..$tag" | awk '
      /^release: / { next }
      { print "- " $0; found = 1 }
      END { if (!found) print "- No user-visible source changes." }
    '
    printf '\n**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$previous_tag" "$tag"
  } > "$notes_file"
else
  printf '## Changes\n\n- Initial release.\n' > "$notes_file"
fi

if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" dist/* --clobber
else
  gh release create "$tag" --title "$tag" --notes-file "$notes_file"
  gh release upload "$tag" dist/* --clobber
fi
