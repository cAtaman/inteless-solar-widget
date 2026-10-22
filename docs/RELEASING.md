# Releases and distribution

GitHub releases are the distributable source of truth. Every published release runs the `Package release` workflow, which verifies the tag, builds the single-file widget, runs tests, and attaches these assets:

- `Inteless-Solar.js` — the installable Scriptable script.
- `Inteless-Solar.js.sha256` — an integrity checksum.
- `README.md` — the setup, feature, and usage guide from the release tag.
- `scriptable-gallery-submission.md` — title, description, and submission metadata.

## Create a release

1. Change the canonical version in `package.json` using `npm run version:patch`, `npm run version:minor`, or `npm run version:major`.
2. Run `npm run check` and install the generated script on an iPhone for an authorized-account check.
3. Commit the source, push the commit, and create an annotated tag named exactly `v` plus `package.json`'s version. For example, version `1.2.0` requires tag `v1.2.0`. GitHub release CI builds the installable script from that tag.
4. Publish the matching GitHub release. The workflow uploads the assets to that release.

For a local release-package check, run `npm run package:release`. It writes files to ignored `dist/`.

## Scriptable Gallery

The Scriptable Gallery is curated. There is no documented Gallery upload API, so no safe CI job can publish directly to it. After a GitHub release is published, submit its `Inteless-Solar.js` asset and the generated Gallery metadata through the Gallery's current contributor process. Do not include account data, credentials, tokens, serial numbers, or live readings.

## iPhone installation and updates

The release asset can be downloaded from:

`https://github.com/cAtaman/inteless-solar-widget/releases/latest/download/Inteless-Solar.js`

Open the downloaded file on the iPhone and import it into Scriptable. Scriptable stores scripts in its own local/iCloud documents area; it does not support a documented automatic GitHub source-sync setting. This widget deliberately does not self-update from a branch or release because an updater would be able to replace code that can access its Keychain entries. Review and import each released script intentionally.
