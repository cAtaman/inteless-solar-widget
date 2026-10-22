# Releases and distribution

GitHub releases are the distributable source of truth. Pushing a release tag runs the `Publish release` workflow, which verifies the tag, builds the single-file widget, runs tests, creates the GitHub Release, and attaches these assets:

- `Inteless-Solar.js` — the installable Scriptable script.
- `Inteless-Solar.js.sha256` — an integrity checksum.
- `README.md` — the setup, feature, and usage guide from the release tag.

## Create a release

1. Change the canonical version in `package.json` using `npm run version:patch`, `npm run version:minor`, or `npm run version:major`.
2. Run `npm run check` and install the generated script on an iPhone for an authorized-account check.
3. Commit the source and push it. Create an annotated tag named exactly `v` plus `package.json`'s version. For example, version `1.2.0` requires tag `v1.2.0`.
4. Push that tag. The workflow creates the matching GitHub Release and uploads the assets automatically. No browser upload or GitHub Release form is needed.

```sh
git push origin main
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

For a local release-package check, run `npm run package:release`. It writes files to ignored `dist/`.

## iPhone installation and updates

The release asset can be downloaded from:

`https://github.com/cAtaman/inteless-solar-widget/releases/latest/download/Inteless-Solar.js`

Open the downloaded file on the iPhone and import it into Scriptable. Scriptable stores scripts in its own local/iCloud documents area; it does not support a documented automatic GitHub source-sync setting. This widget deliberately does not self-update from a branch or release because an updater would be able to replace code that can access its Keychain entries. Review and import each released script intentionally.
