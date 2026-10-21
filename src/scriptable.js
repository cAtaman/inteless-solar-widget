// Scriptable adapter. Never prints credentials, tokens, URLs or raw cloud payloads.
const SolarPhone = (() => {
  const PREFIX = "inteless.solar.v1.";
  const DEFAULTS = { utcOffsetMinutes: 60, batteryPositive: "unknown", gridPositive: "unknown" };
  let deadline = Infinity;
  async function bounded(operation, milliseconds, kind, stage) {
    const remaining = Math.min(milliseconds, deadline - Date.now());
    let timer;
    try {
      if (remaining <= 0) throw new SolarCore.Fault(kind);
      const timeout = new Promise((_, reject) => {
        timer = Timer.schedule(remaining, false, () => reject(new SolarCore.Fault(kind)));
      });
      // Attach handlers to the native promise too: a late rejection is consumed,
      // and a late result cannot continue authentication after our timeout.
      return await Promise.race([Promise.resolve().then(operation), timeout]);
    } catch (error) {
      const fault = error instanceof SolarCore.Fault ? error : new SolarCore.Fault(kind);
      fault.stage = stage; // Fixed local label only; never native exception text.
      throw fault;
    } finally { if (timer) timer.invalidate(); }
  }
  const store = {
    get(key) { return Keychain.contains(PREFIX + key) ? JSON.parse(Keychain.get(PREFIX + key)) : null; },
    set(key, value) { Keychain.set(PREFIX + key, JSON.stringify(value)); },
    remove(key) { if (Keychain.contains(PREFIX + key)) Keychain.remove(PREFIX + key); }
  };
  async function transport({ method, path, params, body, token }) {
    const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
    const request = new Request(SolarCore.BASE + path + (query ? "?" + query : ""));
    request.method = method;
    const remaining = Math.floor((deadline - Date.now()) / 1000);
    if (remaining < 1) throw new SolarCore.Fault("network");
    request.timeoutInterval = Math.min(12, remaining);
    request.allowInsecureRequest = false;
    request.onRedirect = () => null;
    // Compose the dictionary before assigning it. Scriptable bridges this
    // property to NSURLRequest; mutating the object returned by its getter is
    // not a reliable way to add a Content-Type or Authorization header.
    const headers = { Accept: "application/json", "Accept-Language": "en" };
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json;charset=UTF-8";
    request.headers = headers;
    if (body !== undefined) request.body = JSON.stringify(body);
    const stage = path === "/anonymous/publicKey" ? "Fetching public key" :
      path === "/oauth/token/new" ? "Cloud sign-in / session renewal" : "Reading cloud monitoring data";
    const content = await bounded(() => request.loadString(), request.timeoutInterval * 1000, "network", stage);
    if (content.length > 2 * 1024 * 1024) throw new SolarCore.Fault("protocol");
    let json = null;
    try { json = JSON.parse(content); } catch (_) { /* Classify using HTTP status first. */ }
    return { status: request.response?.statusCode || 0, json, headers: request.response?.headers || {} };
  }
  async function encrypt(password, publicKey) {
    // Only a local, empty WebView. No fetched pages, dependencies, or telemetry.
    // Fail closed if WKWebView/BigInt/CSPRNG cannot run in the current context.
    try {
      const web = new WebView();
      // Allow the initial local document to finish loading. A blanket navigation
      // veto installed before loadHTML can cancel that load without settling it.
      // This literal document has no resources; CSP blocks network access.
      await bounded(() => web.loadHTML('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'), 5000, "crypto", "Opening local encryption context");
      web.shouldAllowRequest = () => false;
      const result = await bounded(() => web.evaluateJavaScript(`(() => {
        try {
          if (typeof BigInt !== "function" || typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
          return (${SolarCrypto.rsaEncrypt.toString()})(${JSON.stringify(password)}, ${JSON.stringify(publicKey)}, n => Array.from(crypto.getRandomValues(new Uint8Array(n))));
        } catch (_) { return null; }
      })()`), 5000, "crypto", "Encrypting sign-in locally");
      if (typeof result !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(result)) throw new Error("crypto");
      return result;
    } catch (error) {
      if (error instanceof SolarCore.Fault) throw error;
      const fault = new SolarCore.Fault("crypto"); fault.stage = "Encrypting sign-in locally"; throw fault;
    }
  }
  function client() { return new SolarCore.Client({ transport, store, crypto: { md5: SolarCrypto.md5, encrypt } }); }
  function cache(scope) {
    const fm = FileManager.local();
    const dir = fm.joinPath(fm.libraryDirectory(), "IntelessSolar-" + scope);
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    const path = key => fm.joinPath(dir, encodeURIComponent(key) + ".json");
    function read(key) {
      const file = path(key);
      if (!fm.fileExists(file) && fm.fileExists(file + ".bak")) fm.move(file + ".bak", file);
      return fm.fileExists(file) ? JSON.parse(fm.readString(file)) : null;
    }
    function write(key, value) {
      // Never write raw API payloads or auth objects. Preserve old data on failed write.
      const destination = path(key), temporary = destination + ".tmp";
      fm.writeString(temporary, JSON.stringify(value));
      if (fm.fileExists(destination + ".bak")) fm.remove(destination + ".bak");
      if (fm.fileExists(destination)) fm.copy(destination, destination + ".bak");
      if (fm.fileExists(destination)) fm.remove(destination);
      try { fm.move(temporary, destination); }
      catch (e) {
        if (fm.fileExists(destination + ".bak")) fm.move(destination + ".bak", destination);
        throw e;
      }
      if (fm.fileExists(destination + ".bak")) fm.remove(destination + ".bak");
    }
    return {
      read, write,
      failure(key) { return read(key + ".failure"); },
      recordFailure(key, value) { write(key + ".failure", value); },
      clearFailure(key) { if (fm.fileExists(path(key + ".failure"))) fm.remove(path(key + ".failure")); },
      removeAll() { if (fm.fileExists(dir)) fm.remove(dir); }
    };
  }
  async function message(title, body) {
    const a = new Alert(); a.title = title; a.message = body; a.addAction("OK"); await a.presentAlert();
  }
  async function choose(title, labels, alertStyle = false) {
    if (!labels.length) throw new SolarCore.Fault("empty");
    // Paginate local menus too: keep large accounts usable on a phone.
    let page = 0;
    while (true) {
      const a = new Alert(); a.title = title;
      const rows = labels.slice(page * 12, (page + 1) * 12);
      rows.forEach(label => a.addAction(String(label)));
      const next = (page + 1) * 12 < labels.length;
      if (next) a.addAction("Next page");
      if (page > 0) a.addAction("Previous page");
      a.addCancelAction("Cancel");
      // Scriptable's native alerts have continued to render on this phone while
      // its action sheets dismiss immediately. Use an alert only for the short
      // main command menu; long plant/inverter lists remain paginated sheets.
      const i = await (alertStyle ? a.presentAlert() : a.presentSheet());
      if (i < 0) return -1;
      if (i < rows.length) return page * 12 + i;
      if (next && i === rows.length) page++; else page--;
    }
  }
  async function selectDevice(api, settings) {
    const plants = await api.list("/api/v1/plants");
    const p = await choose("Choose plant", plants.map(x => `${x.name || x.plantName || "Plant"} · ${x.id}`));
    if (p < 0) return null;
    const plant = plants[p];
    if (plant.id === undefined || plant.id === null) throw new SolarCore.Fault("protocol");
    const rows = await api.list(`/api/v1/plant/${encodeURIComponent(plant.id)}/inverters`, { status: -1, type: -2, id: plant.id, lan: "en" });
    const i = await choose("Choose inverter", rows.map(x => `${x.alias || "Inverter"} · ${x.sn || "ID unavailable"}`));
    if (i < 0) return null;
    if (typeof rows[i].sn !== "string" || !rows[i].sn) throw new SolarCore.Fault("protocol");
    const selection = { plantId: String(plant.id), sn: rows[i].sn,
      name: rows[i].alias || plant.name || plant.plantName || "Solar installation" };
    const key = `${selection.plantId}:${selection.sn}`;
    settings.selections = (settings.selections || []).filter(x => `${x.plantId}:${x.sn}` !== key).concat(selection);
    settings.selection = selection;
    store.set("settings", settings);
    return selection;
  }
  async function setup() {
    const a = new Alert(); a.title = "Inteless cloud sign-in";
    a.message = "Enter your authorized pv.inteless.com account here. Credentials and tokens stay in Scriptable Keychain. This replaces the saved account. No inverter settings are changed.";
    a.addTextField("Username / email"); a.addSecureTextField("Password");
    a.addAction("Sign in locally"); a.addCancelAction("Cancel");
    if (await a.presentAlert() < 0) return null;
    const username = a.textFieldValue(0).trim(), password = a.textFieldValue(1);
    if (!username || !password) throw new SolarCore.Fault("auth");
    const old = store.get("settings");
    if (old?.scope) cache(old.scope).removeAll();
    ["token", "cooldown", "settings", "credentials"].forEach(k => store.remove(k));
    const settings = { ...DEFAULTS, scope: UUID.string(), selections: [] };
    store.set("settings", settings);
    store.set("credentials", { username, password });
    const api = client();
    await api.authenticate();
    await selectDevice(api, settings);
    return settings;
  }
  function selection(settings, parameter) {
    if (!parameter) return settings.selection || null;
    return (settings.selections || []).find(x => `${x.plantId}:${x.sn}` === parameter) || null;
  }
  function clock(ms, offset = 60, full = false) {
    if (!Number.isFinite(ms)) return "Unavailable";
    const iso = new Date(ms + offset * 60000).toISOString();
    return (full ? iso.slice(0, 10) + " " : "") + iso.slice(11, full ? 19 : 16);
  }
  function voltages(values) {
    return values.length ? values.map(x => `${x.label} ${SolarCore.valueText(x.value, " V")}`).join(" · ") : "Unavailable";
  }
  function demo(now) {
    const time = new Date(now - 120000).toISOString();
    return { demo: true, cached: false, reading: SolarCore.normalize({
      flow: { time, soc: 76, battV: 53.1, battPower: -800, toBat: true, batTo: false, pvPower: 3100,
        gridOrMeterPower: 0, gridTo: false, toGrid: false, loadOrEpsPower: 2300 },
      battery: { time, soc: 76, voltage: 53.1 },
      detail: { time, status: 1, etoday: 12.8 },
      pv: { time, pvIV: [{ vpv: 320 }, { vpv: 315 }] },
      grid: { time, vip: [{ volt: 229 }] }
    }, DEFAULTS, now) };
  }
  function text(parent, value, size, color = "E7EEE9", weight = false) {
    const t = parent.addText(String(value));
    t.font = weight ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.textColor = new Color(color); t.minimumScaleFactor = 0.65;
    return t;
  }
  const PALETTE = { ink: "0A1115", panel: "142027", hairline: "274047", muted: "9CB4B9", bright: "F1F7F5",
    solar: "F5BD4B", load: "62D4BB", battery: "AAB9FF", grid: "F48B7A", warning: "F3C66B" };
  function primaryVoltage(values) { return values.find(x => x.value !== null)?.value ?? null; }
  function card(parent, label, value, note, accent) {
    const c = parent.addStack(); c.layoutVertically(); c.backgroundColor = new Color(PALETTE.panel); c.cornerRadius = 11;
    c.size = new Size(98, 42);
    c.setPadding(6, 7, 6, 7); text(c, label, 8, PALETTE.muted, true).lineLimit = 1;
    text(c, value, 15, accent, true).lineLimit = 1;
    if (note) text(c, note, 8, PALETTE.muted).lineLimit = 1;
    return c;
  }
  function metricGrid(w, r) {
    const metrics = [
      ["Battery SOC", SolarCore.valueText(r.batterySoc, "%", 0), SolarCore.valueText(r.batteryVoltage, " V"), PALETTE.battery],
      ["PV power", SolarCore.powerText(r.solarPower), "Solar generation", PALETTE.solar],
      [r.loadLabel + " power", SolarCore.powerText(r.loadPower), "Current demand", PALETTE.load],
      ["Battery power", SolarCore.powerText(r.batteryPower, true), r.batteryDirection, PALETTE.battery],
      ["Load voltage", SolarCore.valueText(r.loadVoltage, " V"), "Output / load", PALETTE.load],
      ["Grid voltage", SolarCore.valueText(primaryVoltage(r.gridVoltages), " V"), r.gridAvailability, PALETTE.grid]
    ];
    for (let i = 0; i < metrics.length; i += 3) {
      const row = w.addStack(); row.layoutHorizontally(); row.spacing = 5;
      for (const m of metrics.slice(i, i + 3)) { card(row, ...m); if (m !== metrics[Math.min(i + 2, metrics.length - 1)]) row.addSpacer(0); }
    }
  }
  function cleanedHistory(value) {
    if (value?.version !== 1 || !Array.isArray(value.samples)) return [];
    return value.samples.filter(s => Number.isFinite(s?.at)).map(s => ({ at: s.at,
      solarPower: SolarCore.number(s.solarPower), loadPower: SolarCore.number(s.loadPower), batteryPower: SolarCore.number(s.batteryPower),
      gridPower: SolarCore.number(s.gridPower), batterySoc: SolarCore.number(s.batterySoc) })).slice(-90);
  }
  function history(cacheStore, selected, state) {
    const key = "history:" + selected.plantId + ":" + selected.sn;
    let samples = [];
    try { samples = cleanedHistory(cacheStore.read(key)); } catch (_) { /* Cache history is optional. */ }
    const r = state.reading;
    if (r && !state.cached && !state.throttled && Number.isFinite(r.fetchedAt) && samples[samples.length - 1]?.at !== r.fetchedAt) {
      samples.push({ at: r.fetchedAt, solarPower: r.solarPower, loadPower: r.loadPower, batteryPower: r.batteryPower,
        gridPower: r.gridPower, batterySoc: r.batterySoc });
      samples = samples.slice(-90);
      try { cacheStore.write(key, { version: 1, samples }); } catch (_) { /* A chart must not break a widget refresh. */ }
    }
    return samples;
  }
  function chart(samples) {
    if (typeof DrawContext === "undefined" || typeof Size === "undefined" || samples.length < 2) return null;
    const width = 620, height = 142, left = 30, right = 9, powerTop = 27, powerBottom = 98, socTop = 112, socBottom = 136;
    const ctx = new DrawContext(); ctx.size = new Size(width, height); ctx.opaque = false; ctx.respectScreenScale = true;
    ctx.setFillColor(new Color(PALETTE.panel)); ctx.fillRect(new Rect(0, 0, width, height));
    ctx.setStrokeColor(new Color(PALETTE.hairline)); ctx.setLineWidth(1);
    for (const y of [powerTop, (powerTop + powerBottom) / 2, powerBottom, socTop]) { const p = new Path(); p.move(new Point(left, y)); p.addLine(new Point(width - right, y)); ctx.addPath(p); ctx.strokePath(); }
    const powers = samples.flatMap(s => [s.solarPower, s.loadPower, s.batteryPower, s.gridPower]).filter(Number.isFinite).map(Math.abs);
    const maxPower = Math.max(100, ...powers), x = i => left + (width - left - right) * i / (samples.length - 1);
    const draw = (field, color, top, bottom, scale) => {
      let path = null;
      samples.forEach((sample, i) => {
        const v = sample[field];
        if (!Number.isFinite(v)) { path = null; return; }
        const y = scale(v, top, bottom);
        if (!path) { path = new Path(); path.move(new Point(x(i), y)); }
        else path.addLine(new Point(x(i), y));
        if (i === samples.length - 1 || !Number.isFinite(samples[i + 1][field])) { ctx.setStrokeColor(new Color(color)); ctx.setLineWidth(2.2); ctx.addPath(path); ctx.strokePath(); path = null; }
      });
    };
    const powerY = v => (powerTop + powerBottom) / 2 - (v / maxPower) * ((powerBottom - powerTop) / 2 - 4);
    draw("solarPower", PALETTE.solar, powerTop, powerBottom, powerY); draw("loadPower", PALETTE.load, powerTop, powerBottom, powerY);
    draw("batteryPower", PALETTE.battery, powerTop, powerBottom, powerY); draw("gridPower", PALETTE.grid, powerTop, powerBottom, powerY);
    draw("batterySoc", PALETTE.bright, socTop, socBottom, v => socBottom - Math.max(0, Math.min(100, v)) / 100 * (socBottom - socTop));
    ctx.setFont(Font.semiboldSystemFont(10)); ctx.setTextColor(new Color(PALETTE.muted));
    ctx.drawTextInRect("PV", new Rect(left, 6, 22, 14)); ctx.drawTextInRect("Load", new Rect(left + 35, 6, 34, 14));
    ctx.setTextColor(new Color(PALETTE.battery)); ctx.drawTextInRect("Batt", new Rect(left + 78, 6, 31, 14));
    ctx.setTextColor(new Color(PALETTE.grid)); ctx.drawTextInRect("Grid", new Rect(left + 119, 6, 32, 14));
    ctx.setTextColor(new Color(PALETTE.bright)); ctx.drawTextInRect("SOC", new Rect(left + 160, 6, 28, 14));
    ctx.setTextColor(new Color(PALETTE.muted)); ctx.setFont(Font.systemFont(9));
    ctx.drawTextInRect("±" + SolarCore.powerText(maxPower, true), new Rect(width - 75, powerTop - 10, 70, 13));
    ctx.drawTextInRect("0%", new Rect(2, socBottom - 9, 24, 12)); ctx.drawTextInRect("100%", new Rect(0, socTop - 2, 30, 12));
    return ctx.getImage();
  }
  function freshness(w, r, settings, now, includeChecked) {
    if (!r.sourceAt) { text(w, "Source time unavailable · AGE UNKNOWN", 9, PALETTE.warning).lineLimit = 1; return; }
    text(w, "Cloud source " + clock(r.sourceAt, settings.utcOffsetMinutes, true), 9, PALETTE.muted).lineLimit = 1;
    const source = w.addStack(); source.layoutHorizontally(); source.spacing = 4;
    text(source, r.ageUnknown ? "Known source age" : "Source age", 9, PALETTE.muted);
    const sourceAge = source.addDate(new Date(r.sourceAt)); sourceAge.applyRelativeStyle(); sourceAge.font = Font.systemFont(9); sourceAge.textColor = new Color(PALETTE.muted);
    const fetched = w.addStack(); fetched.layoutHorizontally(); fetched.spacing = 4;
    text(fetched, "Last fetched", 9, PALETTE.muted);
    const fetchedAge = fetched.addDate(new Date(r.fetchedAt)); fetchedAge.applyRelativeStyle(); fetchedAge.font = Font.systemFont(9); fetchedAge.textColor = new Color(PALETTE.bright);
    text(w, r.ageUnknown ? "Some source times missing · age uncertain" : "Stale after " + clock(r.sourceAt + SolarCore.STALE_MS, settings.utcOffsetMinutes), 8, PALETTE.warning).lineLimit = 1;
    if (includeChecked) text(w, "Last fetch " + clock(r.fetchedAt, settings.utcOffsetMinutes, true) + " · iOS may defer the 1 min request", 8, PALETTE.muted).lineLimit = 1;
  }
  function widget(state, selected, settings, family = "large", now = Date.now()) {
    const w = new ListWidget(); w.setPadding(12, 12, 10, 12); w.spacing = 4;
    w.backgroundColor = new Color(PALETTE.ink);
    w.refreshAfterDate = new Date(Math.max(now + SolarCore.POLL_MS, state.retryAt || 0));
    w.url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name());
    const r = state.reading;
    const header = w.addStack(); header.layoutHorizontally();
    text(header, state.demo ? "DEMO" : (selected?.name || "INTELESS SOLAR"), 11, PALETTE.bright, true).lineLimit = 1;
    header.addSpacer(); text(header, state.demo ? "SYNTHETIC" : SolarCore.status(r, now, state.error, state.cached), 8, state.error || state.cached ? PALETTE.warning : PALETTE.load, true).lineLimit = 1;
    if (state.demo) text(w, "DEMO · NOT YOUR INSTALLATION", 8, PALETTE.warning, true).lineLimit = 1;
    if (!r) {
      w.addSpacer(6);
      text(w, "Readings unavailable", 17, PALETTE.bright, true);
      text(w, state.setup ? "Run this script in Scriptable to sign in and select a device." : "Tap to open setup / local diagnostics.", 12).lineLimit = 3;
      return w;
    }
    if (family === "small") {
      text(w, SolarCore.valueText(r.batterySoc, "%", 0), 31, PALETTE.battery, true);
      text(w, "Battery SOC · PV " + SolarCore.powerText(r.solarPower), 10, PALETTE.muted);
      text(w, "Load " + SolarCore.powerText(r.loadPower) + " · Grid " + SolarCore.valueText(primaryVoltage(r.gridVoltages), " V"), 10, PALETTE.muted).lineLimit = 1;
      freshness(w, r, settings, now, false);
    } else {
      metricGrid(w, r);
      if (family === "large") {
        const image = chart(state.history || []);
        if (image) { const graph = w.addImage(image); graph.imageSize = new Size(310, 72); }
        else text(w, "Trend chart begins after two on-device refresh samples.", 9, PALETTE.muted).lineLimit = 1;
        const today = SolarCore.todayValue(r, now, settings.utcOffsetMinutes);
        text(w, `Grid ${SolarCore.powerText(r.gridPower, true)} ${r.gridDirection} · Today ${SolarCore.valueText(today, " kWh", 2)}`, 8, PALETTE.muted).lineLimit = 1;
        text(w, "PV inputs " + voltages(r.pvInputs), 8, PALETTE.muted).lineLimit = 2;
      }
      freshness(w, r, settings, now, family === "large");
    }
    return w;
  }
  async function getState(settings, selected, force = false) {
    const local = cache(settings.scope);
    const state = await SolarCore.refresh({ client: client(), cache: local, selection: selected, preferences: settings, now: Date.now(), force });
    state.history = history(local, selected, state);
    return state;
  }
  async function diagnostics(state, selected, settings) {
    // Local UI, no raw responses, usernames, tokens or serials in this report.
    const r = state.reading;
    const lines = ["LOCAL VALIDATION — actual cloud response if available", "Target device: " + Device.model() + " / iOS " + Device.systemVersion(),
      "State: " + SolarCore.status(r, Date.now(), state.error, state.cached),
      "Account login is only validated if this phone accepted it.", ""];
    const background = store.get("backgroundProbe");
    lines.push("Last no-login Home Screen capability check: " + (background ? `${background.ok ? "PASS" : "FAIL"} at ${clock(background.at, settings.utcOffsetMinutes, true)}` : "NOT RUN (use widget parameter probe)"));
    if (r) {
      lines.push("Battery: " + SolarCore.valueText(r.batterySoc, "%", 0) + " / " + SolarCore.valueText(r.batteryVoltage, " V"),
        "Battery power: " + SolarCore.powerText(r.batteryPower) + " / " + r.batteryDirection,
        "Solar: " + SolarCore.powerText(r.solarPower), "PV voltage: " + voltages(r.pvInputs),
        "Grid: " + SolarCore.powerText(r.gridPower) + " / " + r.gridDirection + " / " + r.gridAvailability,
        "Grid voltage: " + voltages(r.gridVoltages), "Load voltage: " + SolarCore.valueText(r.loadVoltage, " V"), r.loadLabel + ": " + SolarCore.powerText(r.loadPower),
        "Today: " + SolarCore.valueText(SolarCore.todayValue(r, Date.now(), settings.utcOffsetMinutes), " kWh", 2), "",
        "Source timestamp candidates (compare with app):");
      Object.entries(r.times).forEach(([endpoint, t]) => lines.push(`${endpoint}.${t.field}: ${clock(t.ms, settings.utcOffsetMinutes, true)}`));
      lines.push("Fetched: " + clock(r.fetchedAt, settings.utcOffsetMinutes, true));
    }
    lines.push("", "Compare units, directions and Load/EPS coverage with AlpSolarr.",
      "Voltage present/absent is an inference, not an authoritative grid relay state.",
      "Run the actual Home Screen widget too; a foreground preview does not validate background auth.");
    await QuickLook.present(lines.join("\n"), true);
  }
  async function preferences(settings) {
    const a = new Alert(); a.title = "Installation time zone";
    a.message = "UTC offset in minutes for cloud timestamps without a time zone. Lagos = 60. Confirm against AlpSolarr. Fixed offset; no automatic DST.";
    a.addTextField("UTC offset minutes", String(settings.utcOffsetMinutes)); a.addAction("Save"); a.addCancelAction("Cancel");
    if (await a.presentAlert() < 0) return;
    const offset = SolarCore.number(a.textFieldValue(0));
    if (offset === null || offset < -720 || offset > 840 || !Number.isInteger(offset)) throw new SolarCore.Fault("config");
    settings.utcOffsetMinutes = offset;
    // Directions remain unknown unless explicit API flow flags are available.
    // No sign calibration is guessed based on an inverter brand.
    cache(settings.scope).removeAll(); store.set("settings", settings);
  }
  async function capability() {
    const key = await client().request("GET", "/anonymous/publicKey", (() => {
      const nonce = Date.now(); return { nonce, source: "elinter", sign: SolarCrypto.md5(`nonce=${nonce}&source=elinterPOWER_VIEW`) };
    })());
    await encrypt("capability-check", key);
    await message("Foreground capability check passed", `iOS ${Device.systemVersion()}: HTTPS/public key, BigInt, secure randomness and RSA encryption ran here. No account login occurred. The Home Screen widget still needs its own check.`);
  }
  async function backgroundProbe() {
    const w = new ListWidget(); w.backgroundColor = new Color("101E1A"); w.setPadding(14, 14, 14, 14);
    text(w, "NO-LOGIN BACKGROUND CHECK", 12, "F1C66A", true);
    let ok = false;
    try {
      const nonce = Date.now();
      const key = await client().request("GET", "/anonymous/publicKey", { nonce, source: "elinter", sign: SolarCrypto.md5(`nonce=${nonce}&source=elinterPOWER_VIEW`) });
      await encrypt("capability-check", key);
      store.set("probeRoundtrip", { nonce });
      if (store.get("probeRoundtrip")?.nonce !== nonce) throw new Error("storage");
      store.remove("probeRoundtrip");
      // Local file roundtrip only; contains no account data.
      const c = cache("capability"); c.write("probe", { nonce });
      if (c.read("probe")?.nonce !== nonce) throw new Error("cache");
      c.removeAll(); ok = true;
    } catch (_) { /* No raw error details in widget. */ }
    try { store.set("backgroundProbe", { at: Date.now(), ok }); } catch (_) { ok = false; }
    text(w, ok ? "PASS" : "FAIL / RETRY LATER", 22, "FFFFFF", true);
    text(w, "iOS " + Device.systemVersion(), 12);
    text(w, ok ? "HTTPS, RSA, secure random, Keychain and file roundtrip ran here." : "Open Scriptable for foreground check. Network, storage or background crypto unavailable.", 12).lineLimit = 4;
    text(w, "Account login NOT tested.", 10, "F1C66A");
    w.refreshAfterDate = new Date(Date.now() + 3600000);
    return w;
  }
  async function main() {
    const parameter = String(args.widgetParameter || "").trim();
    let settings = store.get("settings");
    if (config.runsInWidget) {
      deadline = Date.now() + 20000;
      if (parameter === "probe") { Script.setWidget(await backgroundProbe()); return; }
      if (parameter === "demo") { Script.setWidget(widget(demo(Date.now()), null, DEFAULTS, config.widgetFamily)); return; }
      const selected = settings ? selection(settings, parameter) : null;
      const state = selected ? await getState(settings, selected) : { setup: true, error: "auth" };
      Script.setWidget(widget(state, selected, settings || DEFAULTS, config.widgetFamily)); return;
    }
    const actions = ["Refresh and preview large", "Sign in / change account", "Select plant / inverter", "Local validation report", "Installation time zone", "Capability check — no login", "Preview DEMO", "Forget account and cached data", "Test one refresh-token grant", "Test full sign-in again"];
    const action = await choose("Inteless Solar · 2026.10.21.3", actions, true);
    if (action < 0) return;
    if (action === 6) { await widget(demo(Date.now()), null, DEFAULTS).presentLarge(); return; }
    if (action === 5) { await capability(); return; }
    if (action === 7) {
      if (settings?.scope) cache(settings.scope).removeAll();
      ["settings", "credentials", "token", "cooldown"].forEach(k => store.remove(k));
      await message("Forgotten", "Saved credentials, tokens, selections and telemetry cache removed from this Scriptable installation."); return;
    }
    if (action === 1 || !settings?.scope) settings = await setup();
    if (!settings) return;
    if (action === 2 || !settings.selection) { await selectDevice(client(), settings); }
    if (action === 4) { await preferences(settings); return; }
    const selected = settings.selection;
    if (!selected) return;
    if (action === 8) {
      const old = store.get("token");
      if (!old?.refresh) throw new SolarCore.Fault("auth");
      const api = client();
      const data = await api.request("POST", "/oauth/token/new", {}, { grant_type: "refresh_token", refresh_token: old.refresh, client_id: "csp-web", source: "elinter" });
      api.saveToken(data, old.refresh);
      await message("One refresh grant accepted", "An immediate refresh worked here. Wait for an actual expired session to validate expiry recovery; run the Home Screen widget too.");
    }
    if (action === 9) {
      store.remove("token");
      await client().authenticate();
      await message("Full sign-in accepted", "This foreground login succeeded. Background recovery still needs an actual Home Screen run.");
    }
    const state = await getState(settings, selected, action === 0 || action === 8 || action === 9);
    if (action === 3) await diagnostics(state, selected, settings);
    else await widget(state, selected, settings).presentLarge();
  }
  return { main, widget, demo, transport, encrypt, selection, clock, voltages, cache, store, history, cleanedHistory, chart };
})();
async function runSolarWidget() {
  try { await SolarPhone.main(); }
  catch (e) {
    const kind = e instanceof SolarCore.Fault ? e.kind : "storage";
    if (config.runsInWidget) {
      Script.setWidget(SolarPhone.widget({ error: kind }, null, { utcOffsetMinutes: 60 }, config.widgetFamily));
    } else {
      const a = new Alert(); a.title = "Inteless setup / refresh stopped";
      a.message = ({ crypto: "Secure RSA encryption could not run in this context. Try the foreground capability check. If it only fails in the Home Screen widget, cached readings remain usable; a native WidgetKit app is the fallback for reliable native crypto.",
        interactive: "The cloud requires verification or a password change. Complete it in the official app/site, then sign in here locally. No settings were changed.",
        auth: "Sign-in rejected or expired. Check the account on pv.inteless.com, then choose Sign in / change account. No password or server response is logged.",
        rate: "The cloud rate-limited requests. Wait at least 10 minutes; saved Retry-After limits are respected.",
        network: "Network or verified HTTPS failed. Check connectivity and try later.",
        empty: "No plants, devices or supported readings were returned.",
        protocol: "The API response was not recognized. Use the a-Shell local validator to identify the compatibility gap without sharing credentials." })[kind] || "Local setup or storage is unavailable. Unlock the phone, rerun Scriptable and use the capability check. No raw error details are logged.";
      if (e instanceof SolarCore.Fault && e.stage) a.message += "\n\nStopped at: " + e.stage + ".";
      if (e instanceof SolarCore.Fault && e.http !== undefined) {
        a.message += `\n\nHTTP ${e.http ?? "unknown"} · cloud code ${e.code ?? "unknown"} · data ${e.dataType}.`;
      }
      a.addAction("OK"); await a.presentAlert();
    }
  }
  Script.complete();
}
