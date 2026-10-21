# Pyto for an Inteless solar widget

## What is currently available and what does it cost?

### Takeaway
Pyto is a viable Python widget host, but its public materials currently describe different generations of the product. The retrieved App Store listing is the relevant installation evidence; future-runtime documentation must not be treated as shipped behavior.

### Cited Findings
- The Nigeria App Store page retrieved on 2026-10-21 lists version 19.0.1 dated 2024-06-09, Python 3.10, iOS 14+, and 975.7 MB. Download is free; unlocking Lite is ₦7,900 and Full ₦14,900, with a three-day trial and a ₦9,900 Lite-to-Full upgrade. `cryptography` is described as Full-exclusive. This is the **Nigeria storefront page**, not confirmation of the user's Apple account region or checkout price. — [App Store](https://apps.apple.com/ng/app/pyto-ide/id1436650069)
- The developer homepage links its documentation to `gatit.es/Pyto/` and says a new update is coming soon. Its version-20 release page describes Python 3.14 and a new PytoRuntime. The new documentation endpoint returned HTTP 403 during direct retrieval, so its complete widget APIs could not be checked. — [Developer homepage](https://pyto.app/), [Version 20 notes](https://pyto.app/releases/v20.0.0.html)
- Public GitHub source was inspected at revision `510cd710846e702437618d472dee439f855cb576`. It is source evidence, not proof of the installed App Store binary's exact build. — [Repository at inspected revision](https://github.com/ColdGrub1384/Pyto/tree/510cd710846e702437618d472dee439f855cb576)

### Inferences
- Do not purchase Full solely on the assumption its crypto package solves autonomous widget authentication. The three-day trial can be used later to test the exact installed build.
- The version-20 migration adds maintenance uncertainty but does not prove the existing version is broken or abandoned.

### Gaps
- The user's actual iOS version, installed Pyto version, account storefront, and live purchase screen were not inspected.
- No installed-device tests or accounts were accessed. No executable code or implementation files were changed in this research.

## Can Pyto update autonomously and authenticate securely without a server?

### Takeaway
Autonomous Python Home Screen widgets are documented. Background crypto availability is **uncertain rather than proven impossible**, and HTTPS certificate verification requires explicit attention because the inspected widget bootstrap weakens one standard-library default.

### Cited Findings
- Pyto documents autonomous “Run Script” widgets and a separate manually populated “In App” mode. The same page warns that autonomous widgets have little RAM and cannot import most bundled native-extension libraries. Its app-assisted workaround recommends a recurring Shortcut, for example daily; merely keeping the app in the app switcher is insufficient. — [Widget documentation](https://pyto.readthedocs.io/en/latest/library/widgets.html)
- Source differs from an absolute reading of that older documentation: `FrameworksImporter` recognizes the widget environment and locates frameworks in the containing app; native `_extensionsimporter.m` has an explicit `#if WIDGET` framework path and calls `dlopen`. This demonstrates loading machinery, **not successful import of cryptography on an iPhone**. — [Python importer, lines 625–675](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Lib/extensionsimporter.py#L625), [Native importer, lines 680–754](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Extensions/_extensionsimporter.m#L680)
- The widget bootstrap imports `ssl`, Rubicon-ObjC and `ctypes.CDLL`. At line 60 it sets `ssl._create_default_https_context = ssl._create_unverified_context`. This affects consumers of that default, such as standard-library HTTPS requests without an explicit context. It is **not evidence that every Pyto HTTPS request bypasses verification**. — [Pinned widget bootstrap, lines 35–60](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/SetupPython.swift#L35)
- Requests documents certificate verification enabled by default; it can take an explicit CA bundle. Python's explicit `ssl.create_default_context()` provides certificate-required client defaults. An implementation can use these rather than the overridden alias, subject to testing the bundled versions and CA paths. — [Requests TLS documentation](https://requests.readthedocs.io/en/latest/user/advanced/#ssl-cert-verification), [Python SSL documentation](https://docs.python.org/3.10/library/ssl.html#ssl.create_default_context)
- Pyto lists Requests among included dependencies, and its widget bootstrap imports SSL itself. That supports HTTPS feasibility; it does not establish correct certificate behavior for a completed script. — [Bundled libraries](https://pyto.readthedocs.io/en/latest/third_party.html), [Widget bootstrap](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/SetupPython.swift)
- Python provides OS-backed secure randomness through `secrets`, and modular exponentiation through three-argument `pow`. These are ingredients for a pure-Python RSA public-key encryption fallback. Python's standard library does not expose a complete ready-made RSA login API. — [secrets](https://docs.python.org/3.10/library/secrets.html), [pow](https://docs.python.org/3.10/library/functions.html#pow)

### Inferences
- The crypto limitation is a development and validation risk, not a reason to assert Python cannot work. A vetted pure-Python RSA implementation or a native Security bridge could avoid dependence on `cryptography`; either adds work and must preserve secure random padding.
- Buying Full does not increase WidgetKit refresh budgets or guarantee a native package fits the widget process.
- A version-specific widget test must verify successful Inteless HTTPS and rejection of an invalid certificate **before sending real credentials**. No such test was performed.
- Foreground login plus token reuse/refresh could reduce background RSA work, but cannot guarantee recovery from an expired refresh token or an interactive cloud challenge. Service authentication requirements apply regardless of language.

### Gaps
- Native `cryptography` import, secure randomness, execution time/RAM, actual Inteless login and refresh have not been tested in a real Pyto widget.
- The exact mapping of public source to App Store 19.0.1, and the behavior of future version 20, remain unverified.

## Can credentials and caches be stored safely and shared with the widget?

### Takeaway
Pyto has secure local password-entry UI, but its commonly documented `userkeys` storage is **not Keychain**. A genuine shared Keychain implementation appears technically feasible through Apple APIs; it needs more integration and an on-device proof than Scriptable's ready-made wrapper.

### Cited Findings
- `pyto_ui.TextField.secure` maps to UIKit's `isSecureTextEntry`, supporting masked local credential entry in the app. — [Pinned UI source, lines 6075–6086](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Lib/pyto_ui.py#L6075)
- `userkeys` describes JSON storage shared between app and widget; source uses `NSUserDefaults.initWithSuiteName('group.pyto')` and stores a JSON dictionary. It must not hold passwords or bearer tokens as a substitute for encrypted secure storage. It can hold non-secret preferences or telemetry. — [userkeys docs](https://pyto.readthedocs.io/en/latest/library/userkeys.html), [Pinned implementation](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Lib/userkeys.py)
- Pyto documents Rubicon-ObjC bridging and its generated `Security` module. That generated module enumerates Objective-C classes; it is not a ready-made wrapper around public C functions `SecItemAdd`/`SecItemCopyMatching`. Widget bootstrap explicitly imports ctypes, so one must not claim all native bridging is prohibited. — [Objective-C docs](https://pyto.readthedocs.io/en/latest/Objective-C.html), [Security module source](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Lib/objc/Security.py), [Widget bootstrap](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/SetupPython.swift#L35)
- Both app and widget entitlement files declare `group.pyto`. **Absence of a separate `keychain-access-groups` entry does not make sharing impossible**: Apple explicitly allows registered app-group names to act as Keychain access groups. An implementation would need to specify that group explicitly; default private app and extension access groups differ. — [App entitlements](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Pyto/PytoRelease.entitlements), [Widget entitlements](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/WidgetExtension.entitlements), [Apple sharing rules](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps), [Apple App Groups entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.application-groups)
- Apple documents different Keychain accessibility classes, affecting availability while locked and after reboot. Choice of class and signed entitlements must be checked for a background widget rather than assuming a successful foreground read proves background availability. — [Apple Keychain protection](https://support.apple.com/en-au/guide/security/secb0694df1a/web)

### Inferences
- A ctypes/Apple Security C-API bridge using `group.pyto` is a plausible no-server secure-storage approach. It has not been written or tested. Class enumeration alone is insufficient evidence.
- Shared preferences or an app-group filesystem are suitable for the last successful **non-secret** snapshot. Tokens and passwords must remain in Keychain. Cache age must come from cloud timestamps, not the time a cached widget was rendered.

### Gaps
- Actual `SecItemAdd` and `SecItemCopyMatching` calls, app-to-widget round-trip, access while locked after first unlock, reboot behavior, and signed installed-binary entitlement behavior remain untested.

## Can its presentation, freshness and lifecycle satisfy this use case?

### Takeaway
Pyto has the widget layout and timeline features needed to display the requested readings. It cannot promise real-time cloud refresh; a prebuilt stale timeline is a potential advantage over hosts exposing only a single snapshot.

### Cited Findings
- Pyto documents small, medium and large layouts, text and date elements, links into the app, `TimelineProvider.timeline()` plus `widget(date)`, and single-widget display with a scheduled reload. — [Widget guide](https://pyto.readthedocs.io/en/latest/library/widgets.html)
- Native source submits `Timeline(entries:policy:)` with `.atEnd` or `.after(date)`. Thus scheduled reloads are WidgetKit requests, not a persistent Python daemon. The source checks whether the containing app is running, using that app if available and its own widget interpreter otherwise. — [Timeline source](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/PyWidget.swift#L140), [Widget provider and lifecycle](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/Widget.swift#L230)
- The manually populated In App provider returns a stored entry with `.never`; it requires updates from the app rather than independently fetching on every requested time. — [In App provider source](https://github.com/ColdGrub1384/Pyto/blob/510cd710846e702437618d472dee439f855cb576/Widget/Widget.swift#L289)

### Inferences
- A timeline could contain one current reading and a future copy labeled stale after a threshold, without inventing future telemetry. OS display timing still needs validation; this does not fetch a new cloud reading.
- For this installation, recommend Pyto only conditionally: choose it if Python is valuable enough to justify proving Keychain bridging, secure TLS, and autonomous auth on the exact build. Do not choose an app-assisted daily Shortcut workaround under the impression it is zero-maintenance.
- No-server operation is feasible in design, but no complete, account-validated Pyto integration exists from this work. Scriptable remains the lower-integration-risk hypothesis, not an established runtime winner.

### Gaps
- No widget visual QA, multiple-device selection UI, lock/reboot lifecycle, unattended long-run refresh, battery measurement or power-direction comparison against AlpSolarr was performed.
- “Supports widgets” and “can import Python packages” are insufficient evidence that this entire account workflow works unattended. The remaining device probes are narrow and decision-relevant, not reasons to pretend the platforms are equivalent.
