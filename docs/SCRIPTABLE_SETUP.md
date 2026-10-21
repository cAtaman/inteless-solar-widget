# Install Inteless Solar

This package contains the **JavaScript Scriptable widget only**. Python and a-Shell are optional diagnostics, delivered separately; neither is needed to run this widget.

Target: the owner's iPhone 12 / iOS 27. Account and background compatibility must be checked locally.

1. Install the official **Scriptable** app by Simon B. Støvring from the App Store.
2. Transfer **Inteless Solar.js** to the iPhone. Import/open it with Scriptable from Files if offered. Otherwise create a new Scriptable script, paste the complete file contents, and name it **Inteless Solar**.
3. Run the script in Scriptable. Select **Capability check — no login**. No credentials are needed for this public-key and crypto check.

   If an older version stays spinning, close Scriptable from the App Switcher and reopen it after the updated script syncs. The updated check bounds each network/crypto step and shows a safe **Stopped at** label on failure. Report that label, never your credentials or a raw server response.
4. Add a **large Scriptable widget** to the Home Screen. Edit it, select **Inteless Solar**, and set its Parameter to **`probe`**. This tests secure crypto, HTTPS, Keychain and cache access in the actual widget process, without logging into an account. A foreground pass alone does not establish background compatibility.
5. Run the script inside Scriptable and select **Sign in / change account**. Enter your authorized **pv.inteless.com** credentials in the local secure dialog. Credentials and tokens stay in Scriptable Keychain. Never put them in the script or chat.
6. Choose your plant and inverter. If needed, set **Installation time zone**. The default UTC offset is Lagos **60 minutes**; confirm cloud timestamps against AlpSolarr.
7. Remove the widget's `probe` parameter to use the selected inverter. For multiple widgets, register each device via **Select plant / inverter**, then pin a widget with `plantId:inverterSerial`. Those identifiers appear in the local selection menus.
8. Use **Local validation report** and compare readings, directions and timestamps with AlpSolarr. Check the actual Home Screen layout as well as the app preview.

The medium (4×2) widget shows the six priority readings: SOC, PV power, load power, battery power, load voltage and grid voltage. The large (4×4) widget adds a local trend image for PV/load/battery/grid power and SOC, plus grid power/direction, daily production and returned PV-input voltages. It begins after two successful refreshes and keeps only normalized on-device samples. Unknown values remain **Unavailable**. Unknown power direction remains **direction unverified**. Grid voltage presence is labeled as an inference.

Freshness uses one compact age line: **Cloud 5 minutes ago · Fetch now**. Cloud age comes from the newest timestamp returned by the monitoring endpoints, which matches the service’s periodic snapshot model. Fetch age records when Scriptable last retrieved that snapshot. The widget now requests a refresh one minute after each run, but iOS controls scheduling and may defer that request; it is not a real-time guarantee.

Offline/network/login failures retain the last successful readings with their original age and a stale indicator. Failure retries and server rate limits are respected. Interactive email verification/password changes must be completed in the official app/site before signing in locally again.

The parameter **`demo`** displays clearly labeled synthetic data. It is never substituted for failed live readings.

No actual account login or iPhone background validation has been claimed by the automated desktop tests. See **docs/VALIDATION.md** for the tests and remaining device checks, and **docs/RESEARCH.md** for API evidence and compatibility limitations. If background secure crypto consistently fails while foreground crypto succeeds, native SwiftUI/WidgetKit is the fallback.

**Forget account and cached data** removes this script's stored credentials, tokens, selections and telemetry cache from Scriptable. No inverter settings are changed by this implementation.
