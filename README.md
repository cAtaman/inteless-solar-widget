# Inteless Solar for Scriptable

A read-only Scriptable Home Screen widget for an authorized `pv.inteless.com` account. It runs directly on the iPhone and stores local credentials and tokens in Scriptable Keychain.

The single installable file is [scriptable/Inteless Solar.js](scriptable/Inteless%20Solar.js). It shows battery, solar, household/load, and grid readings, source/fetch ages, and a large-widget local trend chart. It never changes inverter settings.

## Install

1. Install Scriptable on the iPhone.
2. Import [Inteless Solar.js](scriptable/Inteless%20Solar.js) and run it.
3. Use **Sign in / change account** to enter credentials locally, then select a plant and inverter.
4. Add a Scriptable widget and choose **Inteless Solar**. A large widget includes the trend chart.

See [Scriptable setup](docs/SCRIPTABLE_SETUP.md) for device setup, multiple-device parameters, freshness behavior, and troubleshooting.

## Develop

Requires Node 20 or newer. There are no npm dependencies.

```sh
npm run check
```

Edit files in `src/`, then run `npm run build` to regenerate the committed Scriptable file.

## Versions

The `version` in [package.json](package.json) is the canonical widget version. Every build writes it at the top of the installable Scriptable file and shows it in Scriptable's menu and local validation report. Use `npm run version:patch`, `npm run version:minor`, or `npm run version:major`, then run `npm run check` and make an atomic commit.
