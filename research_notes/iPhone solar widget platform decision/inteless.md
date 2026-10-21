# Inteless cloud compatibility and platform implications

## What is actually verified about the cloud and branding?

### Takeaway
The live public site and its shipped code provide stronger evidence than the historical integrations. They show a shared, configurable Inteless platform with AlpSolarr-specific handling, but do not establish that every PV Pro, PowerView, E-Linter, AlpSolarr or Sunsynk account accepts identical hosts, source values or authentication payloads.

### Cited Findings
- The public page title is `powerview`; its current HTML links `app.c55d2bbc.js` and the inspected runtime/chunks. This was fetched anonymously on 2026-10-21, not inferred from a brand name. — [Live page](https://pv.inteless.com/); [current application bundle](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- The shipped device constants contain `aipSolarr` vendor code 96 and several V96 protocol identifiers. The flow UI specifically branches on that vendor to choose grid versus CT/meter behavior. This is direct first-party evidence that the platform handles AlpSolarr devices. — [device constants](https://pv.inteless.com/static/js/9694.cc6cb098.js); [flow UI](https://pv.inteless.com/static/js/3898.7188df33.js)
- The live application includes distinct PV Pro/PV Lite layout routes; this is evidence of family/OEM support, not proof of interchangeable APIs. — [application bundle](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- The AlpSolarr App Store listing identifies the app and developer Shenzhen Ligao Xinneng Technology; its description alone does not explicitly identify the Inteless authentication API. — [AlpSolarr listing](https://apps.apple.com/us/app/alpsolarr/id6451430072)
- Anonymous `GET /anonymous/config/info?domainUrl=pv.inteless.com` returned HTTP 200/code 0 with null OEM/source/region fields. This agrees with the login UI defaulting to `elinter` when no OEM source is provided. — [anonymous OEM config](https://pv.inteless.com/anonymous/config/info?domainUrl=pv.inteless.com); [login module](https://pv.inteless.com/static/js/7362.49d65aba.js)
- Anonymous `GET /anonymous/area/list` returned HTTP 200/code 0 listing Asia=`https://pv.inteless.com`, Europe=`https://euapi.inteless.com`, North America=`https://usapi.inteless.com`, Oceania=`https://ausapi.inteless.com`. The current live list did not include the older integration's Global=`api.inteless.com` entry. — [anonymous region list](https://pv.inteless.com/anonymous/area/list); [older integration region constants](https://github.com/chukaonline/ha-alpsolar-inteless/blob/23eb52391395d2f3c39efe802df9d1d6266eb63d/custom_components/alpsolar_inteless/const.py)

### Inferences
- Starting with the user's explicitly supplied `pv.inteless.com` is reasonable; installation geography does not establish account shard. Region selection should only be added if local account login shows a different required region.
- We should retain host/source-specific adapters rather than importing a generic Sunsynk client unchanged.

### Gaps
- The user's app traffic/account shard and successful login have not been observed. No personal or published demo account was used.

## What authentication must either runtime support?

### Takeaway
The current site's normal password flow needs HTTPS, MD5 for a protocol query signature, RSA public-key encryption with randomized PKCS#1 v1.5 padding, and secure token persistence. None of these inherently requires a server, but each target runtime must prove its secure random and background reauthentication path on device.

### Cited Findings
- Current code fetches `/anonymous/publicKey` using source, millisecond nonce and an MD5 signature over the nonce/source query plus the protocol suffix `POWER_VIEW`, then encrypts the entered password and posts JSON to `/oauth/token/new`. It does not add a second nonce/sign to the token request in the inspected current Inteless wrapper. — [live application bundle](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- Current login UI passes username, encrypted-via-wrapper password, `grant_type=password`, `client_id=csp-web` and OEM source or `elinter`. — [live login module](https://pv.inteless.com/static/js/7362.49d65aba.js)
- The anonymous public-key request with source `elinter` succeeded (HTTP 200/code 0) during the parent session. Parsing the returned DER with OpenSSL in this research identified a 4096-bit RSA public key. That checks only the anonymous key service, not a login. — [public-key route, nonce/sign required](https://pv.inteless.com/anonymous/publicKey); [bundle describing request construction](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- Inspection of the actual crypto dependency module 5933 shows RSA public exponentiation, a randomized padding block beginning `00 02`, base64 ciphertext, browser `crypto.getRandomValues` initialization, and a weaker fallback when the browser source is unavailable. Do not copy that fallback into a widget or treat it as adequate secure randomness. — [live dependency bundle](https://pv.inteless.com/static/js/chunk-libs.fe23eb07.js)
- The request interceptor attaches a Bearer token. The refresh wrapper constructs `grant_type=refresh_token`, the refresh token, and an `appRefresh` flag based on viewport width before passing it to the common login function. — [live application bundle](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- The supplied Marcin integration differs: it uses source `elinter` for Inteless, but adds a token-request MD5 signature with literal source `sunsynk` and a public-key prefix. Therefore a generic implementation must not assume this is required by the presently shipped Inteless web flow. — [pinned Marcin authentication](https://github.com/MarcinG81/SunSynk_HA_Integration/blob/8c9a098d2da32a0178c2b98385a0d78d3bbec2b3/custom_components/sunsynk/api/auth.py)

### Inferences
- Python does not eliminate the authentication requirement: its advantage is standard-library hashing, secure randomness and convenient crypto choices, contingent on the widget process actually supporting the chosen library.
- JavaScript can perform this protocol using an appropriately licensed/vetted implementation plus a secure random source. Scriptable's actual widget-process capability remains a platform test, not established by an anonymous desktop key fetch.
- A stored refresh token may reduce RSA work, but cannot be treated as a permanent substitute for a functioning login recovery path.

### Gaps
- No token lifetime was measured. An `expires_in` field exists in client token types; the actual account's returned lifetime, refresh lifetime, token rotation, concurrent-device rules and refresh acceptance must be measured locally. Do not assume one hour or a fixed refresh lifetime.
- Exact refresh wire behavior is uncertain from the shipped code alone: the shared login wrapper still attempts public-key retrieval/encryption when refresh parameters omit source/password. Runtime JavaScript behavior and server acceptance need an account-backed test.
- No login POST or credential attempt was made in this research. No MFA/CAPTCHA bypass is proposed.

## Could interactive authentication stop unattended widgets?

### Takeaway
Yes: the site's own login code has interactive verification and password-change branches. We cannot claim this account is password-only or permanently unattended until local validation succeeds.

### Cited Findings
- Current login UI treats code 101 as disabled account, 102 as login error, 113 as a required password-change dialog, and 114 as a verification dialog. — [login module](https://pv.inteless.com/static/js/7362.49d65aba.js)
- The verification dialog labels an email-code field, can request a code, and posts username/code through `loginCheckCode`; the common API module maps it to `/oauth/check/token/code`. — [login module](https://pv.inteless.com/static/js/7362.49d65aba.js); [application API module](https://pv.inteless.com/static/js/app.c55d2bbc.js)

### Inferences
- Either scripted platform should handle a verification-required response by displaying a sign-in-required state with cached readings and requiring local foreground action. Repeated blind password attempts would not solve it.
- A native app can provide a richer local sign-in flow, but it cannot remove a cloud service's interactive verification requirement.

### Gaps
- No evidence establishes whether the user's account triggers verification, whether it recurs, whether it is tied to device/IP changes, or whether CAPTCHA is present in a different branch. Absence of the literal `captcha` in inspected modules does not prove no CAPTCHA anywhere.

## Which monitoring endpoints and field interpretations are supported by evidence?

### Takeaway
The current site has conventional read-only plant/device enumeration and inverter telemetry endpoints. The platform choice does not determine telemetry completeness: account/device payloads and protocol-specific semantics do.

### Cited Findings
- Live code defines GET `/api/v1/plants`, GET `/api/v1/plant/{plantId}/inverters`, and GET `/api/v1/inverter/{sn}/flow`; enumeration uses paginated `data.infos`. — [plant/flow API module](https://pv.inteless.com/static/js/8429.cdeaa622.js)
- Live code defines GET `/api/v1/inverter/{sn}` (detail), `/api/v1/inverter/{sn}/realtime/input`, `/api/v1/inverter/battery/{sn}/realtime`, `/api/v1/inverter/grid/{sn}/realtime`, `/api/v1/inverter/load/{sn}/realtime`, and `/api/v1/inverter/{sn}/pvIVRealtime`. — [application API module](https://pv.inteless.com/static/js/app.c55d2bbc.js)
- The shipped flow UI displays `pvPower`, `gridOrMeterPower`, `loadOrEpsPower` and/or `homeLoadPower` in W, SOC in %, battery voltage from `battV` or protocol-specific battery fields in V, and `detail.etoday` as kWh. It uses absolute battery power plus `batTo`/`toBat` and grid flow flags `gridTo`/`toGrid`; thus sign alone should not be generalized across brands/endpoints. — [flow UI](https://pv.inteless.com/static/js/3898.7188df33.js)
- AlpSolarr-specific CT/meter selection and multiple-load/battery cases are explicit branches in that UI. — [flow UI](https://pv.inteless.com/static/js/3898.7188df33.js)
- The older AlpSolarr integration treats positive battery power as charge, reads station summaries, returns missing fields as zero, and computes energy by integration rather than directly using the inverter's daily-production field. Those choices cannot be carried over blindly. — [integration sensor implementation](https://github.com/chukaonline/ha-alpsolar-inteless/blob/23eb52391395d2f3c39efe802df9d1d6266eb63d/custom_components/alpsolar_inteless/sensor.py)

### Inferences
- No inverter model is needed to begin login/enumeration. Ask for it only if the actual device protocol cannot be interpreted from metadata/payloads and app comparison.
- A whitelist of specific read-only routes is safer than assuming all GET routes are harmless: this API also has GET settings/action routes outside the widget's scope.
- The widget should preserve unavailable readings as unavailable, use explicit direction flags when reliable, retain per-endpoint timestamps, avoid presenting inverter connectivity as grid availability, and compare selected-device readings against AlpSolarr locally.

### Gaps
- Authenticated endpoint reachability, source timestamp names/time zones, per-PV-input voltage payload shape, grid-voltage phases, grid availability semantics, actual power directions, and whether load refers to EPS or full household are unvalidated for this account. Desktop source inspection is not telemetry validation.
- No official public API stability contract or rate-limit quota was found. Polling cadence needs conservative caching/backoff, and cloud-upload latency is unknown independent of iOS scheduling.

## How reliable and reusable are the supplied leads?

### Takeaway
They are useful protocol leads, not drop-in iOS solutions. None was used to log into this account; no implementation code was changed during the pause.

### Cited Findings
- `paul-ridgway/sunsynk-node-api-client`, pinned tree `8e371c8f666621ee3f4987a049489216d7f936ad`, declares ISC in package metadata, with no LICENSE file in the retrieved tree. Its implementation depends on Node `crypto` and axios; those Node runtime APIs are not automatically available in Scriptable. It also adds Sunsynk-specific request signing that differs from the current Inteless wrapper. — [package metadata](https://github.com/paul-ridgway/sunsynk-node-api-client/blob/8e371c8f666621ee3f4987a049489216d7f936ad/package.json); [client](https://github.com/paul-ridgway/sunsynk-node-api-client/blob/8e371c8f666621ee3f4987a049489216d7f936ad/src/client.ts)
- `chukaonline/ha-alpsolar-inteless`, pinned tree `23eb52391395d2f3c39efe802df9d1d6266eb63d`, has an MIT license. Its current inspected implementation still posts plaintext-over-HTTPS password JSON to older `/oauth/token`, reauthenticates per poll, and reads `/api/v1/plant/station/list`. Its compatibility with current pv.inteless.com was not demonstrated. — [license](https://github.com/chukaonline/ha-alpsolar-inteless/blob/main/LICENSE); [implementation](https://github.com/chukaonline/ha-alpsolar-inteless/blob/23eb52391395d2f3c39efe802df9d1d6266eb63d/custom_components/alpsolar_inteless/sensor.py)
- `MarcinG81/SunSynk_HA_Integration`, pinned tree `8c9a098d2da32a0178c2b98385a0d78d3bbec2b3`, advertises GPL-3.0 and requires Home Assistant/Python native crypto dependencies; useful as source evidence, not code to copy without handling its license. — [repository/license](https://github.com/MarcinG81/SunSynk_HA_Integration); [authentication](https://github.com/MarcinG81/SunSynk_HA_Integration/blob/8c9a098d2da32a0178c2b98385a0d78d3bbec2b3/custom_components/sunsynk/api/auth.py)
- The bmerry gist dates to 2022 and uses `/oauth/token`, positional first plant/inverter selection, and historical chart queries. No explicit reuse license was visible on the inspected gist. — [gist](https://gist.github.com/bmerry/1f9317485830e736974c98cb1e5fd3b5)

### Inferences
- Implement protocol behavior independently or deliberately choose appropriately licensed dependencies. Do not paste an entire GPL integration or unlicensed gist into a differently licensed app.
- If both scripting runtimes pass their local capability checks, the remaining cloud compatibility work is substantially the same in either language.

### Gaps
- No claim is made that the partial implementation already passes authentication, parsing, crypto correctness, caching tests or iPhone runtime validation. All are future work after the user resumes code changes.
