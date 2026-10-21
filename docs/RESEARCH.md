# Inteless monitoring protocol evidence

Inspected **21 October 2026**. The title of the supplied host is `powerview`. Its live application handles AlpSolarr vendor/protocol codes and distinct PV Pro layouts. This supports a platform-family relationship, not interchangeable accounts, hosts or payloads. The implementation stays pinned to **https://pv.inteless.com**; it does not send credentials to guessed regional hosts.

## Authentication

Current first-party files: [application](https://pv.inteless.com/static/js/app.c55d2bbc.js), [login](https://pv.inteless.com/static/js/7362.49d65aba.js), [dependencies](https://pv.inteless.com/static/js/chunk-libs.fe23eb07.js).

1. GET `/anonymous/publicKey?nonce={milliseconds}&source=elinter&sign={md5}`. Signature input: `nonce={milliseconds}&source=elinterPOWER_VIEW`.
2. Parse the returned base64 DER RSA public key (4096 bits in the anonymous response inspected). Encrypt the UTF-8 password using randomized **RSAES-PKCS1-v1_5**, base64 the ciphertext.
3. POST JSON `/oauth/token/new`: `username`, encrypted `password`, `grant_type=password`, `client_id=csp-web`, `source=elinter`.
4. Data envelope has `code=0`, `data.access_token`; attach `Authorization: Bearer ...` to monitoring requests. Read `expires_in` seconds when present. Actual account token lifetime is not measured.

The live password wrapper does **not** add a separate token-request nonce/sign, unlike the inspected Sunsynk clients. The web refresh wrapper passes `grant_type=refresh_token`, refresh token and `appRefresh` into a common login wrapper that also tries public-key/password work. Exact wire/server acceptance remains unvalidated. This implementation deliberately tests the conventional JSON refresh grant with client/source and falls back to one password login after an auth/protocol rejection. This is an account compatibility hypothesis, not a verified refresh contract. Rotation is preserved if returned.

The live UI has code 113 for password change and 114 for email verification. These are sign-in-required conditions, not retry loops. No verification-code, password-change, settings or real-time-trigger endpoint is implemented.

The anonymous key request was verified without an account. No password grant, refresh grant, account enumeration or authenticated telemetry request was performed by the agent. The public/demo account present in the site's source was not used.

## Allowed monitoring paths

All monitoring operations are GET. Only authentication uses POST. This is an explicit allowlist because the upstream API also has GET action routes.

| Path | Intended response/fields |
|---|---|
| `/api/v1/plants?page=&limit=` | `data.infos`, plant `id`, names, optional `total` |
| `/api/v1/plant/{id}/inverters` | Paginated `data.infos`, inverter `sn`, alias; filters `status=-1`, `type=-2`, `id`, `lan=en` |
| `/api/v1/inverter/{sn}/flow` | `pvPower`, `battPower`, `soc`, `battV`, `gridOrMeterPower`, load fields, `batTo/toBat`, `gridTo/toGrid` |
| `/api/v1/inverter/{sn}` | `etoday`, device `status` and metadata |
| `/api/v1/inverter/{sn}/realtime/input` | Candidate `pac`, `pvIV[].vpv` |
| `/api/v1/inverter/battery/{sn}/realtime` | Candidate aggregate `soc`, `voltage`, `power` |
| `/api/v1/inverter/grid/{sn}/realtime` | Candidate `pac`, `vip[].volt`, optional explicit `connected` |
| `/api/v1/inverter/{sn}/pvIVRealtime` | Optional fallback; only recognized `pvIV[].vpv` shape is interpreted |
| `/api/v1/inverter/load/{sn}/realtime` | Optional load fallback `pac` |

Routes are defined by the [current API module](https://pv.inteless.com/static/js/app.c55d2bbc.js) and [plant/flow module](https://pv.inteless.com/static/js/8429.cdeaa622.js). The [current flow UI](https://pv.inteless.com/static/js/3898.7188df33.js) displays flow power in W, SOC in %, battery voltage in V and detail `etoday` in kWh. `pvIV[].vpv`, grid `vip[].volt` and auxiliary `pac`/battery fields are supported by inspected integration source, not this account's payloads; each must be locally compared. Unexpected shapes remain unavailable.

`batTo` denotes outward battery flow/discharging; `toBat` charging. `gridTo` denotes inward grid flow/import; `toGrid` export, based on the live flow UI. Conflicting/missing flags do not imply a direction. No universal signed-power convention is assumed. Multi-load systems may expose `homeLoadPower` separately from `loadOrEpsPower`. The UI's protocol-specific battery arrays are not guessed into a single aggregate: if an account only supplies unrecognized per-pack fields, that aggregate is unavailable until its schema is verified.

Grid voltage above 80 V is labeled **voltage present**, zero across available phases **no voltage reported**; these are explicit heuristics, not authoritative relay/grid-availability states. Inverter offline status does not imply grid offline. An explicit `connected` boolean, if supplied, is preferred but still requires local semantics confirmation.

Source time field names and time-zone semantics remain unverified for the actual account. `time`, `timestamp`, `updateAt` and `collectTime` are candidates, not interchangeable guarantees. `updateAt` might describe metadata rather than measurement age; compare it with AlpSolarr. Unknown endpoint times remain unknown. No inverter model is needed to start authentication/enumeration; request one only if protocol metadata and local comparison cannot settle interpretation.

## Licenses and reuse

This project's protocol, parsers and narrowly scoped RSA public-encryption helpers are original implementations. There are **no runtime third-party dependencies**, copied integration implementations, private-key operations, or insecure-random fallback. RSA compatibility tests independently use native Node crypto/OpenSSL. Those tests are not a cryptographic audit. MD5 is used solely for the server's required anonymous-query signature; HTTPS certificate verification remains required.

| Lead inspected | Pinned revision | License / compatibility assessment |
|---|---|---|
| [paul-ridgway/sunsynk-node-api-client](https://github.com/paul-ridgway/sunsynk-node-api-client) | `8e371c8f666621ee3f4987a049489216d7f936ad` | ISC in package metadata; no LICENSE file found in inspected tree. Node crypto/axios are not Scriptable APIs; its token signing differs from current Inteless. No code copied. |
| [chukaonline/ha-alpsolar-inteless](https://github.com/chukaonline/ha-alpsolar-inteless) | `23eb52391395d2f3c39efe802df9d1d6266eb63d` | MIT. Uses older `/oauth/token` and station summaries; returns missing readings as zero and assigns a battery sign convention. Not copied or assumed compatible. |
| [MarcinG81/SunSynk_HA_Integration](https://github.com/MarcinG81/SunSynk_HA_Integration) | `8c9a098d2da32a0178c2b98385a0d78d3bbec2b3` | GPL-3.0. Useful field/path evidence, but its signed auth differs. No implementation or fixtures copied. |
| [bmerry gist](https://gist.github.com/bmerry/1f9317485830e736974c98cb1e5fd3b5) | Inspected single historical revision | No explicit license found. Old password flow, first-device selection and chart history queries. No code copied. |

The pure-Python `rsa` package was considered, but its [maintainer archived it](https://pypi.org/project/rsa/4.9.1/). No package from that project was installed, copied or bundled. The phone validator therefore needs only the standard library and public-key encryption tested separately against OpenSSL.

Scriptable references: [Request/TLS](https://docs.scriptable.app/request/), [Keychain](https://docs.scriptable.app/keychain/), [WebView](https://docs.scriptable.app/webview/), [widget refresh](https://docs.scriptable.app/listwidget/), [dynamic dates](https://docs.scriptable.app/widgetdate/). A headless WebView's actual widget-context behavior is deliberately tested by the `probe` widget; source inspection alone does not establish it on iOS 27.

The Python validator constructs a verified SSL context directly, rejects redirects, and aborts on `getpass` echo fallback. It does not rely on a-Shell's default HTTPS factory or any unverified Keychain wrapper. It is optional and does not weaken the widget's requirement for secure on-device token storage.
