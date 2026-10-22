# Inteless Solar for Scriptable

A read-only [Scriptable](https://scriptable.app/) Home Screen widget and Siri Shortcut for an authorized `pv.inteless.com` account. It runs directly on the iPhone and stores local credentials and tokens in Scriptable Keychain.

Requires iOS 15.5 or later, which is Scriptable's current App Store minimum.

The release-built installable file is [Inteless-Solar.js](https://github.com/cAtaman/inteless-solar-widget/releases/latest/download/Inteless-Solar.js). It shows battery, solar, household/load, and grid readings, source/fetch ages, and a large-widget local trend chart. It never changes inverter settings.

## Install

1. Install Scriptable on the iPhone.
2. Download and import [Inteless-Solar.js](https://github.com/cAtaman/inteless-solar-widget/releases/latest/download/Inteless-Solar.js), then run it.
3. Use **Sign in / change account** to enter credentials locally, then select a plant and inverter.
4. Add a Scriptable widget and choose **Inteless Solar**. A large widget includes the trend chart.
5. Optional: create a Shortcut with Scriptable's **Run Script** action, choose **Inteless Solar**, and use a phrase such as “Solar status.” Siri will speak the current summary and return structured values to Shortcuts.

See [Scriptable setup](docs/SCRIPTABLE_SETUP.md) for device setup, multiple-device parameters, freshness behavior, Siri requests, and troubleshooting. See [releasing and distribution](docs/RELEASING.md) for GitHub release assets, Gallery submission, and safe updates.

## Develop

Requires Node 20 or newer. There are no npm dependencies.

```sh
npm run check
```

Edit files in `src/`, then run `npm run build` to generate `dist/Inteless-Solar.js` locally. The generated file is not committed; GitHub release CI builds and publishes it.

## Versions

The `version` in [package.json](package.json) is the canonical widget version. Every build writes it at the top of the installable Scriptable file and shows it in Scriptable's menu and local validation report. Use `npm run version:patch`, `npm run version:minor`, or `npm run version:major`, then run `npm run check` and make an atomic commit.

## GitHub releases

Publishing a matching semantic GitHub release runs CI, builds the single-file widget, and attaches the installable JavaScript file, SHA-256 checksum, this README, and Gallery-submission metadata. The Gallery has no documented publication API, so its curated submission is manual. Details: [releasing and distribution](docs/RELEASING.md).
