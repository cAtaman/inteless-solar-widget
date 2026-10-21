# Scriptable and native WidgetKit viability

Research date: 21 October 2026. Research only; no implementation edits, device execution, user-account authentication, or widget installation were performed. Platform docs and public store metadata establish capabilities, not end-to-end compatibility with this user's account.

## Can Scriptable securely fetch Inteless cloud data and keep credentials on the phone?

### Takeaway
Scriptable has documented HTTPS requests, local secure password input, encrypted Keychain storage, and file persistence. These support the basic architecture, but the Keychain documentation does not expose accessibility classes or explicitly prove locked-device and widget-extension behavior on the user's installed version.

### Cited Findings
- `Request` exposes HTTP method, headers, string/Data body, JSON parsing, response status and headers, configurable idle timeout, and a redirect callback. Redirects are allowed by default; returning null from `onRedirect` stops a redirect. Requests deemed insecure, including invalid certificates, are rejected by default unless `allowInsecureRequest` is enabled. Thus bearer tokens, JSON login bodies, expiry metadata, 401 handling and Retry-After logic can be implemented without browser cookies or a server. The documented timeout is an idle timeout, not a whole-widget execution budget. [Request API](https://docs.scriptable.app/request/)
- `Alert.addSecureTextField` masks input behind dots, permitting foreground credential setup locally on the phone. Password entry must occur in the app, not in a background widget. [Alert API](https://docs.scriptable.app/alert/)
- `Keychain` provides contains/get/set/remove with string keys and values, and its docs say values use an encrypted database. No accessibility-class, biometric-presence, per-script isolation, or access-group configuration argument is documented. [Keychain API](https://docs.scriptable.app/keychain/)
- `FileManager.local()` provides local storage; the library directory is intended for long-term storage and isn't accessible through Files. Cache/temporary directories can be purged and the docs warn those directories are not shared with some extension contexts. The library docs do not explicitly guarantee sharing with WidgetKit in the current shipped version; a foreground-to-widget cache roundtrip is an acceptance test. [FileManager API](https://docs.scriptable.app/filemanager/)
- Scriptable's App Store description explicitly says Home Screen widget scripts run without opening the app, and scripts can be exported/shared and accessed as plain JavaScript files. [Nigeria App Store listing](https://apps.apple.com/ng/app/scriptable/id1405459188)

### Inferences
- A direct-cloud implementation can retain access/refresh tokens and optionally credentials in Keychain, persist normalized telemetry locally, stop redirects, use certificate validation, and request monitoring data only. Automatic token refresh is application logic; Scriptable does not supply an Inteless OAuth SDK.
- A safe design must distinguish Keychain failure from missing credentials and show cached/unavailable data instead of writing secrets to a plaintext fallback.
- All scripts within one host app should be treated as part of the same trust boundary unless Scriptable establishes isolation; documentation reviewed does not establish per-script Keychain isolation.

### Gaps
- Keychain accessibility while locked, after reboot before/after first unlock, and app/widget shared access were not tested. Documentation alone should not be presented as proof those lifecycle cases pass.
- The user's iOS version and installed app version are unknown. Platform documentation may lag implementations.

## Does Scriptable have the RSA and secure randomness required for current cloud login?

### Takeaway
Scriptable has no documented native RSA/MD5/CSPRNG API. Pure JavaScript math can supply RSA/MD5, but securely obtaining encryption padding randomness during background re-login remains a concrete device-validation gate; it is not yet a proven blocker or proven success.

### Cited Findings
- Scriptable uses JavaScriptCore and explicitly says scripts do not run in a browser and browser-specific objects are absent. Therefore browser `window.crypto` or Node's `crypto` cannot simply be assumed to exist in the main Scriptable runtime. Its public API catalog lists no cryptography bridge. [Scriptable JavaScript environment](https://docs.scriptable.app/)
- Scriptable `WebView` can load local HTML and evaluate JavaScript, with optional completion callbacks; a remote page or third-party server is not required for local computation. The documentation does not mention Home Screen widget compatibility or guarantee WebCrypto globals within that context. [WebView API](https://docs.scriptable.app/webview/)
- WebKit documents `crypto.getRandomValues` as a cryptographically strong RNG. This is a WebKit capability; it is not proof that a Scriptable widget can create and execute a local WebView within its resource/time constraints. [WebKit cryptography documentation](https://webkit.org/blog/7790/update-on-web-cryptography/)
- WebKit's JavaScript engine already included BigInt integration by iOS 14.5. That supports plausibility on Scriptable's currently listed iOS 15.5 minimum, but does not substitute for checking the actual Scriptable execution context and syntax support. [WebKit Safari 14.1 release](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/), [Scriptable minimum iOS](https://apps.apple.com/ng/app/scriptable/id1405459188)
- The UUID API documents universal uniqueness only. It makes no cryptographic entropy guarantee, so it should not be silently repurposed as an encryption CSPRNG. [UUID API](https://docs.scriptable.app/uuid/)
- In an old developer-authored forum reply, Simon B. Støvring said Scriptable does not display web content in widgets. That concerns displayed content, not headless computation: it cannot prove that `WebView.evaluateJavaScript` is unusable during widget execution. [Developer reply](https://talk.automators.fm/t/widget-examples/7994/37)

### Inferences
- A vetted bundled JavaScript crypto library can perform the public-key operation and protocol hash, but its RNG dependency must be traced and verified. No fallback to `Math.random`, timestamp entropy, or an undocumented UUID-security assumption is acceptable.
- Foreground RSA authentication plus stored refresh tokens could reduce background crypto use. It does not eliminate the requirement to handle revoked or expired refresh tokens honestly: if full background reauthentication fails, display a sign-in-needed state and keep old readings stale.
- A persistent securely seeded pure-JavaScript DRBG is technically conceivable, but introduces sensitive state/concurrency/seed lifecycle design and is not an established capability verified here. It should not be advertised as a trivial solution.
- The correct Scriptable decision gate is a local test of RSA + secure randomness in the actual Home Screen widget process, plus refresh-token renewal and full re-login after renewal rejection.

### Gaps
- No primary source found establishes that headless WebView + `crypto.getRandomValues` succeeds in a current Scriptable Home Screen widget. No primary source found establishes that it categorically cannot work either.
- No supported native CSPRNG alternative was found in Scriptable's documented API. A bundled library's license, cryptographic behavior and widget resource usage remain to be checked before reuse.
- This research did not run or validate the partially written project crypto helpers. They are not a validated dependency or proof of device compatibility.

## How often can the widget update, and will stale data stay clearly labeled?

### Takeaway
Neither Scriptable nor native WidgetKit provides continuous solar telemetry. Scriptable supports dynamically updating date labels but does not document a public multi-entry timeline API; this matters for automatically switching a static freshness badge when network refreshes are delayed.

### Cited Findings
- `ListWidget.refreshAfterDate` specifies the earliest permitted refresh, not a deadline or guaranteed schedule. iOS can defer refresh for low battery or a rarely viewed widget; the docs also warn that widget memory limits can cause rendering failure. There is no documented hard byte/runtime quota in the reviewed official Scriptable API. [ListWidget API](https://docs.scriptable.app/listwidget/)
- `WidgetDate` dates update periodically while visible and provide relative, offset and timer styles. A data-age display can continue changing without rerunning the full script. [WidgetDate API](https://docs.scriptable.app/widgetdate/)
- Apple describes typical frequent-view widget budgets of 40–70 timeline reloads per day, roughly 15–60 minutes between reloads, with variability. This is system guidance, not a promise about either host app. Widget providers should keep planned timeline entries approximately five minutes apart or more. [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)
- WidgetKit can accept multiple future timeline entries for predictable changes, separately from obtaining new data over the network. [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)
- Native SwiftUI date text and timer/progress views can keep time-based information current while a widget extension isn't executing. [Displaying dynamic dates](https://developer.apple.com/documentation/widgetkit/displaying-dynamic-dates)

### Inferences
- A Scriptable implementation must show the source timestamp, a dynamic age, and an explicit expiry threshold/deadline. A static green `FRESH` label alone is misleading because it may remain onscreen when iOS delays the next script run.
- A native implementation can provide a future stale timeline entry, such as the last reading with a stale flag 15 minutes later, without needing another successful HTTP request. Timeline scheduling remains system-managed; it is better control, not a hard-real-time guarantee.
- Fetch time and inverter source time must remain distinct. Displaying a new fetch time cannot establish that the cloud reading is new.
- One large widget is the likely best fit for all requested battery/PV/grid/load/energy/timestamp fields. Smaller sizes should deliberately summarize and reveal details after tapping. Exact text fit, multi-string counts, Dynamic Type, tinting and contrast require device previews.

### Gaps
- No guarantee of exact refresh cadence can be made on the user's phone.
- The public Scriptable API does not document submitting future alternative widget snapshots. This is an absence from the reviewed API, not proof no internal mechanism exists.
- Numeric claims such as a universal 30 MB or 30 second Scriptable widget limit were not substantiated from current primary documentation and should not be stated as guarantees.

## What are Scriptable installation costs, dependencies, compatibility and maintenance risks?

### Takeaway
Scriptable is a small, free App Store host with optional tip purchases and no user-managed Apple signing. Its latest version visible in the researched listing dates to 2024; that is a maintenance signal to test current iOS compatibility, not evidence that the product is abandoned.

### Cited Findings
- The Nigeria storefront lists Scriptable as free with in-app purchases, size 28.9 MB, minimum iOS/iPadOS 15.5, latest visible version 1.7.19 dated 30 September 2024. Listed purchases are Small Tip ₦1,500, Medium Tip ₦4,900 and Large Tip ₦7,900. Metadata is storefront/device dependent and may change. The user's Apple Account storefront has not been established. [Nigeria listing](https://apps.apple.com/ng/app/scriptable/id1405459188)
- Recent visible release notes concern iOS 18 widget tinting and rendering fixes; earlier notes mention iOS 17 widget stability. These establish shipped maintenance at those dates, not a support commitment for subsequent iOS versions. [Version history](https://apps.apple.com/ng/app/scriptable/id1405459188)
- The store description says scripts synchronize using iCloud Drive, are plain JavaScript files, and can be exported/shared. [Installation/distribution capabilities](https://apps.apple.com/ng/app/scriptable/id1405459188)
- The listing's privacy section says the developer reports collecting no data and Apple has not verified the privacy declaration. This does not mean a user-authored monitoring script makes no network requests; its intended Inteless requests still transmit credentials/tokens to the authorized service. [Privacy declaration](https://apps.apple.com/ng/app/scriptable/id1405459188)

### Inferences
- A single-file bundled script avoids an npm runtime on iPhone and simplifies import/update. Installation still involves installing the host, importing the file, local credential setup, and choosing the script in a Scriptable Home Screen widget.
- Cloud API changes remain a maintenance risk regardless of language. Host-app future compatibility is an additional dependency for both Scriptable and Pyto.
- iCloud can be used to move script source, but source should contain no credentials; on-device tokens belong in secure storage. A server is unnecessary for the intended direct-cloud design if authentication passes the device checks.

### Gaps
- Actual installed/download size, current pricing in the user's account region, compatibility with the user's iOS release and long-term developer plans were not verified on-device.
- No App Store purchase or installation was attempted.

## What does native SwiftUI and WidgetKit add, and what does it cost operationally?

### Takeaway
Native SwiftUI/WidgetKit provides documented platform crypto, explicit Keychain accessibility/sharing, and timeline control. It creates a real signed app and widget extension, with a larger build/distribution responsibility, and retains iOS refresh limits.

### Cited Findings
- Apple documents adding a Widget Extension target to an app in Xcode and building its views in SwiftUI. WidgetKit supports a subset of SwiftUI views, not arbitrary app UI. [Creating a widget extension](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)
- Apple Security exposes `SecKeyAlgorithm.rsaEncryptionPKCS1` from iOS 10 onward, avoiding a custom JavaScript RSA implementation. [RSA PKCS1 API](https://developer.apple.com/documentation/security/seckeyalgorithm/rsaencryptionpkcs1)
- Apple documents Keychain Sharing and App Groups, including using an app-group identifier as a Keychain access group, so the containing app and related extension can deliberately share secrets and cached data with correct entitlements. [Keychain sharing](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
- Apple recommends `kSecAttrAccessibleAfterFirstUnlock` for background apps: data is unavailable after restart until first unlock, then remains accessible until next restart. This class migrates with encrypted backups; a device-only variant is a separate design choice. [Keychain background accessibility](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlock)
- Widget network requests can be inline or background URLSession requests. Extensions can be halted before a request finishes; Apple provides explicit background-session events and completion mechanisms. Native implementation offers control over this lifecycle but does not remove resource limits. [Widget networking](https://developer.apple.com/documentation/widgetkit/making-network-requests-in-a-widget-extension)
- Xcode's supported releases have macOS requirements; a normal native build workflow requires a compatible Mac and Xcode. [Xcode requirements](https://developer.apple.com/xcode/system-requirements)
- Free Apple Account Personal Team provisioning expires seven days after issuance and requires rebuilding/reinstalling. Apple also documents app/device limits. [Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account)
- Apple Developer Program enrollment is US$99 annually, in local currency where available, with regional pricing possible. It enables distribution routes; this is not a required fee for Scriptable/Pyto scripts. [Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment)
- Capability availability depends on program membership. Apple's published capability table includes App Groups and Keychain Sharing, but the text extraction lost its checkmark cells; this research therefore did not establish the exact free-Personal-Team entitlement combination for this proposed app. [Capability matrix](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)

### Inferences
- Native is the strongest route if a standalone app, an app-specific identity, explicit storage policy, and detailed timeline behavior are priorities. It is a larger implementation and distribution effort than a hosted script.
- Weekly free-signing rebuilds are unsuitable for a set-and-forget appliance-like widget. Paid development/distribution can reduce this friction, but the exact route and its renewal obligations must be selected; do not imply paying once grants permanent unrestricted installation.
- Native does not require an always-on server for HTTPS cloud polling and caching. Native push updates would require upstream/provider and notification infrastructure and are outside this no-server proposal.

### Gaps
- Exact signing/provisioning capabilities for the user's Apple Account and preferred distribution route require a local Xcode check. Do not promise that a free-signed app can share all needed app/extension resources before checking entitlements.
- No native app, provisioning profile, TestFlight build or real-device lifecycle test was produced.

## Which verification should determine the platform choice?

### Takeaway
The shortest honest path is to compare documented capabilities now, then require targeted on-device acceptance tests before committing to an unattended widget. Desktop fixtures are insufficient to settle widget authentication, storage, or refresh lifecycle.

### Cited Findings
- Both Scriptable and WidgetKit documentation explicitly acknowledge widget scheduling/resource constraints; that supports testing the widget execution context separately from foreground preview. [Scriptable widgets](https://docs.scriptable.app/listwidget/), [Apple widget networking](https://developer.apple.com/documentation/widgetkit/making-network-requests-in-a-widget-extension)

### Inferences
- Scriptable acceptance gates: secure local credential input; foreground RSA with strong randomness; shared app/widget Keychain and library-cache read/write; background refresh-token renewal; forced expiry and revoked-refresh recovery including full RSA re-login; TLS/redirect rejection; offline and 429 fallback; dynamic source age; delayed refresh; reboot/locked-device behavior; all readings compared with AlpSolarr including sign directions and units.
- Native acceptance gates add correct entitlements, Keychain protection class, shared container behavior, signing/installation renewal path, and future stale timeline entries.
- Recommendation is conditional: Scriptable remains the best documented low-friction hosted option, but no claim of actual Inteless widget compatibility is justified until the crypto and lifecycle gates pass. Native is the fallback for concrete host limitations or a deliberate preference for a standalone product, not a way around iOS scheduling.

### Gaps
- None of these acceptance tests has been run on the user's iPhone or actual monitoring account. They are proposed checks after the user decides to resume implementation, not completed validation.
