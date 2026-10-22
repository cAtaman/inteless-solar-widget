# Contributing to Inteless Solar

Thanks for helping improve this Scriptable widget. It accesses an authorized `pv.inteless.com` account only for monitoring; contributions must preserve that boundary.

## Local workflow

1. Use Node.js 20 or newer. The project has no package dependencies.
2. Make changes in `src/`, not directly in `scriptable/Inteless Solar.js`.
3. Run `npm run check`. It rebuilds the installable script and runs the synthetic unit tests.
4. Review the generated `scriptable/Inteless Solar.js` diff and commit source, generated artifact, and relevant tests together.

For a release candidate, update the semantic version in `package.json`, run `npm run package:release`, and test the release asset on a device with a separate authorized account. Do not commit `dist/`.

## Safety and privacy

- Do not add write, command, refresh-trigger, or configuration endpoints.
- Do not add a fallback that replaces missing data with zero.
- Do not commit real credentials, access tokens, serial numbers, URLs containing credentials, cloud payloads, screenshots with personal account data, or local caches.
- Use clearly synthetic fixtures. Tests must run without a cloud account or network access.
- Preserve the cache and stale-state behavior: a failed fetch may show the last successful reading only with its original cloud age and a clear stale label.

## Pull requests

Describe the user-visible behavior, test command and result, and any device validation. Keep the Scriptable artifact synchronized with its sources. Changes that affect authentication, endpoint paths, field names, units, timestamp interpretation, or power directions need focused synthetic coverage and should be validated against a contributor's own authorized account before release.
