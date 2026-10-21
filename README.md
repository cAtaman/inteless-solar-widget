# Inteless Solar for iPhone

A read-only **Scriptable Home Screen widget**, plus an optional **a-Shell Python account validator**. Neither needs an always-on server. The widget logs in independently; a-Shell is a diagnostic tool, not its background engine.

Target supplied by the owner: **iPhone 12, iOS 27**. Scriptable installation, script import and menu launch have been observed on the phone; account data and background execution remain **unvalidated**. Desktop fixture tests pass; see [validation](docs/VALIDATION.md).

## Start on your iPhone

The ready-to-import widget is **[scriptable/Inteless Solar.js](scriptable/Inteless%20Solar.js)**. It is one self-contained file; no npm, Python, server or imported JavaScript modules are needed on the phone.

### 1. Optional: check a-Shell first

Copy [phone/validate_inteless.py](phone/validate_inteless.py) into a-Shell's Documents directory using Files, AirDrop, or Finder File Sharing if available. In a-Shell, change to the folder containing that file and run:

```sh
python3 validate_inteless.py --probe
python3 validate_inteless.py --probe --network
```

The first command checks Python, trusted CA availability, explicit certificate verification and secure randomness without networking. The second also checks the **anonymous** Inteless public key and public-key encryption. Neither signs in or asks for a password.

When those pass, run:

```sh
python3 validate_inteless.py
```

First enter **only the word `test`** at the masked-input check. If characters appear, stop with Control-C before entering credentials. The tool also aborts if Python warns that it cannot hide input. Then enter your account username and password at the hidden local prompts. **Never put credentials in commands, chat, source, `.env`, or screenshots.** Password and tokens exist only in this process's memory; they are not printed or saved. Python cannot promise memory zeroization.

Select your plant and inverter from the local lists. Compare the displayed readings and raw flow flags with AlpSolarr. `Unavailable` is not zero. The listed units follow the source evidence; they still need this account comparison.

Optional: `python3 validate_inteless.py --refresh-test` performs one immediate refresh grant after a new login. An immediate grant does not prove recovery after actual expiry. No refresh token is exported to the widget.

If trusted CA certificates or masked input are unavailable in a-Shell, stop and use Scriptable's secure setup instead. Do not disable certificate verification. This script has no package-install step and does not assume `cryptography` is bundled.

### 2. Import into Scriptable and check its runtime

1. Install **Scriptable** from its official App Store listing if needed. This is a hosted widget, not a standalone compiled app.
2. Transfer `Inteless Solar.js` to the phone. Open/import it with Scriptable if offered by the Files share sheet. Alternatively create a new Scriptable script, paste the file's complete contents, and name it **Inteless Solar**.
3. Run it inside Scriptable. Choose **Capability check — no login**. This tests public HTTPS access and local RSA/secure randomness in the foreground, without account credentials.
4. Add a Scriptable **large** widget to the Home Screen. Edit it, choose **Inteless Solar**, set its Parameter to **`probe`**, and set interaction to run the script if that option is offered. The no-login background check reports PASS or FAIL. It tests RSA, secure randomness, Keychain and local-file roundtrips in the actual widget process. It makes no account login request. Open Scriptable's local validation report later to see the recorded result.
5. A failed probe does not identify one universal cause: network, local storage and background crypto can each fail. A foreground PASS alone does not prove background compatibility on iOS 27.

### 3. Sign in locally and select the installation

Run the script in Scriptable and choose **Sign in / change account**. Enter your authorized **pv.inteless.com** credentials in the native dialog. The password uses a secure field. Credentials and tokens are stored in **Scriptable Keychain**, never in the script or telemetry cache.

Choose a plant, then an inverter. All pages are enumerated; the code does not silently choose the first device. Run **Installation time zone** if needed: the default is Lagos **UTC+01:00 (60 minutes)** for timestamps that omit a time zone. Confirm cloud wall-clock times against AlpSolarr. This setting is a fixed offset, not an automatic daylight-saving time zone.

Remove the widget's `probe` parameter. With an empty parameter it follows the current selection. To pin different widgets to different registered devices, select each device once in the app, then use `plantId:inverterSerial` as that widget's parameter. Both identifiers are shown in the local selection lists; parameters are identifiers, not credentials. Unknown parameters require setup and do not cause arbitrary device requests. One account is stored at a time; replacing it clears the previous local cache and selections.

Run **Refresh and preview large**, then **Local validation report**. Compare every available field with AlpSolarr. Previewing in the app is not an actual Home Screen execution test.

## What the widget shows

The **medium (4×2)** widget is a six-reading live monitor: battery SOC, PV power, household/load power, battery power and direction, load voltage, and grid voltage/availability. The **large (4×4)** widget adds an on-device trend chart for PV, load, battery and grid power plus SOC, then shows grid import/export, today’s production, and each returned PV input voltage. Battery voltage remains beneath SOC. Large history begins after two successful widget refreshes and is stored only as normalized local samples; it does not use a guessed cloud-history API. Very large numbers of PV strings can exceed the physical text area; the local report shows all recognized strings.

Units: W/kW for power, V for voltage, % for SOC, kWh for daily generation. Power directions use explicit cloud flags. Without those flags, the widget says **direction unverified**; it does not assume a brand-wide sign convention. `Load / EPS` may cover only backed-up circuits. `Today` is the inverter detail's `etoday` field shown by the current cloud client; compare that field's coverage with AlpSolarr, particularly if the installation has multiple inverters.

The source-time adapter recognizes `time`, `timestamp`, `updateAt`, and `collectTime` as **candidates**, supports epoch seconds/milliseconds and time-zone-qualified ISO timestamps, and retains per-endpoint times in local diagnostics. Candidate semantics are not validated for your account yet. It uses the oldest recognized time; a missing endpoint timestamp produces **AGE UNKNOWN**. Fetch/check time never substitutes for source time. Bad future clocks, offline status, network/auth failures and stale data are labeled. Previous-day cached daily generation becomes unavailable instead of appearing as today's production.

The stale threshold is **15 minutes**. The script normally avoids another cloud fetch for **10 minutes**, backs off failures, and honors longer HTTP `Retry-After` limits. **iOS decides when to run the widget**; these are not guaranteed refresh intervals. The dynamic age can continue aging without fetching new readings, but Scriptable has no documented multi-entry timeline API to flip a static badge later. Always use the displayed date/time and deadline, not a snapshot label alone.

## Failure and account recovery

- Expired tokens use a refresh grant, then one password re-login if appropriate. Monitoring requests retry authentication once, never indefinitely. Returned `expires_in` is used; no token lifetime is fabricated if absent.
- Email verification or password-change responses stop automatic retries. Complete the official app/site's interactive flow yourself, then sign in locally again. These scripts do not change passwords, bypass verification, or touch inverter settings.
- `Test one refresh-token grant` and `Test full sign-in again` are foreground diagnostics, not proof of background expiry recovery. Let a real session expire and observe the actual Home Screen widget before treating unattended recovery as validated.
- Failed refreshes retain the last usable snapshot with its original timestamps. Missing fields in a newer snapshot are unavailable, not filled with old values. Repeated failures are throttled. Partial endpoint responses are labeled.
- **Forget account and cached data** removes this implementation's stored credentials/tokens, selections and telemetry cache from Scriptable. It does not revoke cloud sessions server-side.

If secure RSA consistently passes in the foreground but fails in the actual widget process, the concrete blocker is background secure crypto execution in Scriptable. A native **SwiftUI/WidgetKit** app using Apple Security/Keychain is the appropriate fallback; the app still obeys iOS refresh limits. There is no evidence yet that this blocker occurs on your phone.

The parameter **`demo`** previews clearly labeled synthetic readings, with no login or account fetch. Demo is never substituted silently for failed live data.

## Mac-assisted transfer

A USB cable can enable Finder File Sharing for apps that expose it; it is not a generic iPhone shell or app installer. This Mac currently has no Xcode `devicectl`. Finder showed a connected iPhone; an app's file-sharing container has not been verified. iPhone Mirroring is now configured, Scriptable is installed, and the single widget file synced through Scriptable's existing iCloud documents folder and launched successfully. Home Screen widget execution is still pending. The owner completes required device/Apple authentication locally. Existing cloud credentials should be entered on the phone, not supplied to this chat.

## Develop and verify on the Mac

Requires Node 20+ and Python 3.10+. No npm dependencies:

```sh
npm run check
python3 scripts/package.py
```

The package command creates **`dist/IntelessSolar-Widget.zip`**, containing only the JavaScript widget, its concise setup guide, API/validation notes, license and SHA-256 manifest. The optional Python diagnostic is a **separate** `dist/validate_inteless.py`; it is not part of the widget installation. Neither delivery includes `.env`, credentials, captures, editor files, or local caches. Source edits go in `src/`; regenerate the committed Scriptable file using `npm run build`.

Read [API evidence and licenses](docs/RESEARCH.md), [tests and pending device checks](docs/VALIDATION.md), and the [platform comparison](reports/iPhone%20solar%20widget%20platform%20decision.md). No official public API stability contract or quota was found.

## Versions

The `version` in [package.json](package.json) is the canonical widget version. Every `npm run build` writes it at the top of the installable Scriptable file and shows it in Scriptable's menu and local validation report. Use `npm run version:patch`, `npm run version:minor`, or `npm run version:major`, then run `npm run check` and make an atomic commit. Semantic versions identify a released build without incorrectly claiming that the generated file contains its own Git commit hash.
