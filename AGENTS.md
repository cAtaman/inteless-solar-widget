# Inteless Solar Widget

This repository builds one read-only JavaScript widget for the Scriptable iOS app. Its editable source is in `src/`; release CI generates the installable `dist/Inteless-Solar.js` artifact.

## Development

- Use Node.js 24.22.1 or newer and run `npm run check` before committing.
- Edit `src/core.js`, `src/crypto.js`, or `src/scriptable.js`, then run `npm run build` to regenerate the ignored Scriptable artifact in `dist/`.
- Keep the runtime dependency-free. The Node build and Bash release scripts have no third-party dependencies.
- Keep changes small and commit them atomically. Do not add Codex, Anthropic, or generated-by footers as commit co-authors.

## Security and data handling

- This client may use only the fixed `https://pv.inteless.com` host and the read-only routes allowlisted in `src/core.js`. Never add an inverter setting, command, refresh-trigger, or arbitrary-host request.
- Credentials, tokens, account selections, and telemetry remain on the iPhone in Scriptable Keychain/local storage. Never add them to source, fixtures, test output, logs, commits, or release assets.
- Tests use synthetic data only. Avoid raw HTTP captures, real serial numbers, usernames, tokens, and account readings.
- The widget must distinguish unavailable data from zero, preserve source age separately from local fetch age, and label cached data as stale.

## Releases and documentation

- `package.json` supplies the canonical semantic version. A GitHub release tag must be `v` plus that exact version.
- Run `npm run package:release` only after `npm run check`; it writes ignored release assets to `dist/`.
- Keep `README.md`, `docs/SCRIPTABLE_SETUP.md`, and `docs/RELEASING.md` aligned with behavior available in the generated single-file script.
