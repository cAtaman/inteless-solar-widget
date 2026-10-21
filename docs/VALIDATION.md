# Validation status

**Desktop fixtures/interoperability pass; the Scriptable foreground capability check passed on the owner's iPhone; and a local Mac run completed the owner's authorized, read-only cloud login and monitoring reads. Actual Home Screen widget refresh behavior remains unvalidated.** Target reported by owner: iPhone 12 with iOS 27. No hardware claim is inferred from the Mac tests.

## Automated checks

`npm run check` builds the single-file Scriptable artifact and runs JavaScript plus Python tests. The suite contains **35 JavaScript tests and 11 Python tests**, with all passing on this Mac. Node tests use only synthetic responses and Scriptable API mocks. Python tests make no external account requests. Test RSA private keys are generated temporarily for independent interoperability checks, never committed or used as credentials.

Meaningful coverage:

- Numeric strings, genuine zero versus missing/null/blank/invalid/nonfinite fields, SOC bounds and unsupported units.
- W/kW and Wh/kWh conversions; battery/PV/grid/load/daily production mapping against synthetic shapes; phases/strings and missing voltage.
- Direction flags overriding raw signs; unknown/conflicting flags staying unverified; household versus EPS; voltage heuristics versus inverter status.
- Source seconds/milliseconds, ISO offsets and installation wall-clock offset; invalid wall-clock dates; unknown times, old snapshots, future clocks, offline status and previous-day cached daily production.
- Signed anonymous key query, encrypted-password envelope, returned expiry, missing expiry, refresh rotation, one-time credential fallback and bounded 401 retry.
- Email verification/password change, rejected credentials, rate-limit `Retry-After`, safe network/protocol errors and pagination loops.
- Cache fetch throttling, failure backoff, retaining original source/check times on failure, partial/missing readings, corrupt/wrong-scope cache, disk failures and backup restoration.
- Read-only route allowlists rejecting settings, shutdown, update-trigger and arbitrary write paths.
- MD5 helper compared with Node native crypto; RSAES-PKCS1-v1_5 public encryption for **2048 and 4096 bits**, Unicode input, nonzero randomized padding, ciphertext variability and fail-closed random errors, independently checked with Node native RSA and Python/OpenSSL.
- Local WebView encryption executed in an isolated JavaScript VM with a native CSPRNG; absent CSPRNG fails closed. This is **not** WKWebView or iOS validation.
- Initial local WebView navigation is allowed before installing its navigation veto. Mocked stuck document loads, JavaScript evaluations and native network requests hit independent watchdogs, invalidate their timers, and report fixed stage labels. Late results cannot resume authentication; late native rejections are consumed. Timers and navigation callbacks in these tests are mocks.
- A Chrome request on this Mac, made with a fresh public nonce and no account data, returned the expected anonymous public-key envelope (`code: 0`, `success: true`, base64 DER key). This verifies the current public route and signing convention from this network. It does not test the Scriptable `Request` runtime or an account.
- The client accepts a valid, TLS-delivered success envelope if a Scriptable-like adapter supplies no usable HTTP status metadata. Known status codes remain authoritative: a known `503` still becomes a network error, and a missing response body remains a protocol error.
- Widget construction through mocks for small/medium/large sizes: source date/time, dynamic-age element, stale deadline, unavailable labels, demo marking and device-parameter validation. This is **not** visual QA on a phone.
- Python verified TLS context even when the host's default context factory is replaced with an unverified one; fatal masked-input fallback; no password/token CLI arguments or disk persistence; fixed safe errors and selected-value output instead of raw payload dumps.

The TLS context configuration is tested, but invalid-certificate rejection inside a-Shell/Scriptable on iOS 27 has not been independently observed. Crypto interoperability tests do not constitute an audit. No guarantee of uninterrupted login, refresh timing, widget execution duration or background WebView support is claimed.

## Public cloud check

The anonymous HTTPS public-key service responded successfully during source research. The key was inspected as 4096-bit RSA. The completed Python validator's `--probe --network` also passed from this Mac: verified HTTPS, anonymous key retrieval, and secure-random public encryption. This proves neither the owner's account compatibility, the phone's runtime nor any authenticated monitoring response. No published demo account, password grant, refresh grant, telemetry call, inverter settings or trigger operation was used by the agent.

## Owner's local acceptance checks

Installation smoke check observed through iPhone Mirroring: the official Scriptable app opened, `Inteless Solar.js` synced from its existing iCloud folder, and the script displayed its local action menu. The cloud sign-in dialog was opened for owner-only credential entry. No credentials or phone screenshots are recorded in this repository. The foreground capability check subsequently passed on iOS 27.0.1: verified HTTPS/public-key retrieval, BigInt, secure randomness and local RSA encryption. It performed no account login.

The owner reported an indefinite spinner after submitting local credentials. The original no-login capability check also stayed spinning when run through Mirroring. The original encryption helper installed an unconditional navigation veto before loading its blank local document; this is a suspected cause, not yet an independently confirmed WKWebView diagnosis. The update lets that resource-free, CSP-restricted document load first and adds watchdogs (12 seconds per network request, 5 seconds per WebView operation, each capped by the widget deadline). It displays the fixed operation stage on foreground failure. The rebuilt script was copied to the existing Scriptable iCloud location with exact byte verification. Phone acceptance of this fix is pending; no account login was retried by the agent. A subsequent phone run reached a safe protocol error instead of spinning, while the same signed public-key request succeeded in Chrome. A pending diagnostic update reports only HTTP status, cloud code, and response data type, never response messages or content.

After the fixes were installed, a direct launch through iPhone Mirroring returned to Scriptable without showing its action sheet. Because foreground error alerts do render on this phone, the short main command menu now uses `Alert.presentAlert()`; paginated plant/inverter choices retain their sheet interface. The capability check verified that command menu on the phone. An initial foreground full sign-in reached HTTP 415; the header fix was made and covered by a Scriptable bridge-style test.

The owner then ran the local Python validator on this Mac and entered credentials only into its hidden prompts. It completed the password grant, plant/inverter selection, and the allowlisted flow, detail, PV, battery and grid reads. The validator reported requested monitoring categories and source-time fields when supplied; it kept identifiers, tokens and raw payloads out of the repository and this record. The phone must still repeat this full sign-in after the synced header fix, then exercise an actual Home Screen widget refresh.

1. Run the a-Shell probes, if desired, then verify **masked input using only nonsecret `test`** before a local account sign-in. Stop on TLS or input-safety errors.
2. Run the Scriptable foreground capability check, then add a Home Screen widget with parameter `probe`. Verify PASS in the actual background process and that the in-app local validation report can read its recorded result.
3. Sign in through Scriptable's native secure field. Select the intended plant/inverter and compare SOC, voltages, power, direction, load/EPS coverage, daily production and source time with AlpSolarr. Confirm missing fields stay unavailable. Confirm the installation offset for time-zone-less timestamps.
4. Check the actual large Home Screen widget at the phone's normal display size. Check long names and all returned PV inputs; reduce nonessential text only after observing layout. Medium/small deliberately omit some detailed readings.
5. Exercise one foreground refresh grant, then wait for real expiry and check the Home Screen widget. Verify refresh rejection either recovers securely or clearly requests local sign-in without repeated blind attempts. Interactive verification is handled in the official app/site.
6. With an existing cached snapshot, disable network access on the phone temporarily and rerun. Confirm the values retain their original source/check time and display STALE; restore connectivity. Backoff may defer retry for 10 minutes or longer if rate-limited. Do not manufacture real server rate limits through repeated requests.
7. Leave the widget untouched past its freshness deadline, lock/unlock the phone, and later reboot. Verify source time/age remain legible and cached data is not mistaken for live data. Check whether Keychain is available after unlocking. A static snapshot label cannot guarantee a timely stale transition.

Do not send passwords, tokens, raw captures, or `.env` files to this chat. A safe result to report is: probe PASS/FAIL, login accepted/rejected, which named readings are unavailable, and whether values/directions/times match AlpSolarr. Actual values and device identifiers are not necessary for the first troubleshooting pass.

## Concrete fallback condition

If foreground secure crypto succeeds but repeated **actual Home Screen** probes cannot run secure RSA/WebView on this phone, Scriptable's background crypto is the blocker. Build a SwiftUI/WidgetKit app using native Apple Security and shared Keychain, rather than adding a permanent server or replacing the widget with a website. Native signing/distribution and iOS scheduling still apply. This condition has not yet been observed.
