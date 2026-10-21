// Original implementation. Protocol evidence and limitations: docs/RESEARCH.md.
const SolarCore = (() => {
  const BASE = "https://pv.inteless.com";
  // This asks iOS to refresh after a minute. WidgetKit remains free to defer
  // execution, so source age is always rendered independently of this hint.
  const POLL_MS = 60 * 1000;
  const STALE_MS = 15 * 60 * 1000;
  class Fault extends Error {
    constructor(kind, retryAt = 0) { super(kind); this.kind = kind; this.retryAt = retryAt; }
  }
  function number(v) {
    if (typeof v !== "number" && typeof v !== "string") return null;
    if (typeof v === "string" && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())) return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  }
  function first(...values) { return values.map(number).find(v => v !== null) ?? null; }
  function bool(v) { return v === true || v === 1 || v === "1" ? true : v === false || v === 0 || v === "0" ? false : null; }
  function quantity(v, expected) {
    if (v && typeof v === "object") {
      const n = number(v.value), u = v.unit;
      if (n === null) return null;
      if (u === expected) return n;
      if (expected === "W" && u === "kW") return n * 1000;
      if (expected === "kWh" && u === "Wh") return n / 1000;
      return null;
    }
    return number(v); // Bare endpoint fields use the units documented in RESEARCH.md.
  }
  function pick(unit, ...values) { return values.map(v => quantity(v, unit)).find(v => v !== null) ?? null; }
  function day(ms, offsetMinutes) { return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10); }
  function timestamp(v, offsetMinutes = 60) {
    if (v === null || v === undefined || v === "") return null;
    const n = number(v);
    if (n !== null) {
      const ms = n < 1e11 ? n * 1000 : n;
      return ms >= Date.UTC(2000, 0, 1) && ms <= Date.UTC(2100, 0, 1) ? ms : null;
    }
    if (typeof v !== "string") return null;
    let s = v.trim();
    const wall = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
    if (wall) {
      const parts = wall.slice(1).map(Number);
      const utc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
      const d = new Date(utc);
      if (d.getUTCFullYear() !== parts[0] || d.getUTCMonth() + 1 !== parts[1] || d.getUTCDate() !== parts[2] || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return null;
      return utc - offsetMinutes * 60000;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
    // Date.parse normalizes some impossible dates (e.g. February 30).
    if (timestamp(s.slice(0, 19), 0) === null) return null;
    const ms = Date.parse(s); return Number.isFinite(ms) ? ms : null;
  }
  function sourceTime(data, offset) {
    for (const key of ["time", "timestamp", "updateAt", "collectTime"]) {
      const ms = timestamp(data?.[key], offset);
      if (ms !== null) return { ms, field: key, raw: String(data[key]) };
    }
    return null;
  }
  function direction(power, outward, inward, positive, outName, inName) {
    if (power === null) return "unavailable";
    if (power === 0) return "idle";
    const out = bool(outward), into = bool(inward);
    if (out === true && into === false) return outName;
    if (into === true && out === false) return inName;
    if (out === true && into !== true) return outName;
    if (into === true && out !== true) return inName;
    if (out === true && into === true) return "direction unverified";
    if (positive === "out") return power > 0 ? outName : inName;
    if (positive === "in") return power > 0 ? inName : outName;
    return "direction unverified";
  }
  function normalize(raw, preferences, now) {
    const f = raw.flow || {}, b = raw.battery || {}, p = raw.pv || {}, g = raw.grid || {}, d = raw.detail || {}, l = raw.load || {};
    const power = pick("W", f.battPower, b.power);
    const gridPower = pick("W", f.gridOrMeterPower, g.pac);
    const soc = first(f.soc, b.soc);
    // `existsThreeLoad` only tells us that the inverter can report a separate
    // household total. It does not guarantee that this particular snapshot
    // contains it, so preserve the ordinary Load/EPS value as a fallback.
    const householdPower = pick("W", f.homeLoadPower);
    const fallbackLoadPower = pick("W", f.loadOrEpsPower, l.pac);
    const gridVoltages = Array.isArray(g.vip) ? g.vip.map((x, i) => ({ label: `L${i + 1}`, value: quantity(x?.volt, "V") })) : [];
    const loadVoltage = pick("V", f.loadVoltage, f.loadVolt, f.loadV, l.voltage, l.loadVoltage, l.loadVolt, l.vip?.[0]?.volt);
    const pvRows = Array.isArray(p.pvIV) ? p.pvIV : raw.pvExtra?.pvIV;
    const pvInputs = Array.isArray(pvRows) ? pvRows.map((x, i) => ({ label: `PV${i + 1}`, value: quantity(x?.vpv, "V") })) : [];
    // Preserve source timestamps per endpoint; never replace them with the fetch time.
    const times = {};
    for (const [name, payload] of Object.entries(raw)) {
      const t = sourceTime(payload, preferences.utcOffsetMinutes);
      if (t) times[name] = t;
    }
    const sourceTimes = Object.values(times).map(x => x.ms);
    // The service snapshots readings upstream. Use its newest supplied
    // timestamp as the cloud-snapshot time; the separate fetchedAt value says
    // when this device last retrieved that snapshot.
    const sourceAt = sourceTimes.length ? Math.max(...sourceTimes) : null;
    const future = sourceTimes.some(x => x > now + 5 * 60000);
    const timestampCoverageIncomplete = Object.entries(raw).some(([name, payload]) => Object.keys(payload).length > 0 && !times[name]);
    const volts = gridVoltages.map(x => x.value).filter(x => x !== null);
    const connected = bool(g.connected);
    const availability = connected !== null ? (connected ? "connected" : "disconnected") :
      volts.some(v => v > 80) ? "voltage present" : volts.length && volts.every(v => v === 0) ? "no voltage reported" : "unavailable";
    return {
      batterySoc: soc !== null && soc >= 0 && soc <= 100 ? soc : null,
      batteryVoltage: pick("V", f.battV, b.voltage),
      batteryPower: power,
      batteryDirection: direction(power, f.batTo, f.toBat, preferences.batteryPositive, "discharging", "charging"),
      solarPower: pick("W", f.pvPower, p.pac), pvInputs,
      gridPower, gridDirection: direction(gridPower, f.gridTo, f.toGrid, preferences.gridPositive, "import", "export"),
      gridVoltages, gridAvailability: availability,
      // For multi-load systems the web client uses homeLoadPower when present.
      loadPower: householdPower ?? fallbackLoadPower,
      loadLabel: householdPower !== null ? "Household" : "Load / EPS",
      // Only explicit, voltage-shaped fields are used. Some accounts expose
      // no load/output voltage; that remains unavailable rather than inferred
      // from grid voltage.
      loadVoltage,
      todayKwh: quantity(d.etoday, "kWh"),
      sourceAt, times, future, ageUnknown: sourceAt === null, timestampCoverageIncomplete, fetchedAt: now,
      offline: number(d.status) === 0 || number(f.status) === 0,
      hasReadings: [f.pvPower, p.pac, f.battPower, b.power, f.soc, b.soc, g.pac, f.gridOrMeterPower, f.loadOrEpsPower, f.homeLoadPower, l.pac, d.etoday].some(v => quantity(v, "W") !== null) || pvInputs.some(x => x.value !== null) || gridVoltages.some(x => x.value !== null)
    };
  }
  function status(reading, now, error = null, cached = false) {
    if (!reading) return ["auth", "interactive", "crypto"].includes(error) ? "SIGN IN REQUIRED" : "NO DATA";
    if (reading.offline) return "INVERTER OFFLINE";
    if (error || cached) return "STALE · " + ({auth:"SIGN IN", interactive:"VERIFY ACCOUNT", crypto:"OPEN SCRIPTABLE", rate:"RATE LIMITED", network:"NETWORK", protocol:"API CHANGED", storage:"CACHE ERROR", partial:"PARTIAL FETCH", empty:"EMPTY DATA", cooldown:"RETRY LATER"}[error] || "CACHED");
    if (reading.future) return "STALE · CLOCK MISMATCH";
    if (now - reading.fetchedAt > STALE_MS) return "STALE";
    if (reading.sourceAt && now - reading.sourceAt > STALE_MS) return "STALE";
    if (!reading.sourceAt || reading.ageUnknown) return "AGE UNKNOWN";
    return "CLOUD SNAPSHOT";
  }
  function retryAt(header, now) {
    const seconds = number(header);
    const parsed = seconds !== null ? now + Math.max(0, seconds) * 1000 : Date.parse(header);
    return Math.max(now + POLL_MS, Number.isFinite(parsed) ? parsed : 0);
  }
  // This transport boundary intentionally allows only authentication and known monitoring routes.
  function allowed(method, path) {
    if (method === "POST") return path === "/oauth/token/new";
    if (method !== "GET") return false;
    return path === "/anonymous/publicKey" || path === "/api/v1/plants" ||
      /^\/api\/v1\/plant\/[^/]+\/inverters$/.test(path) ||
      /^\/api\/v1\/inverter\/[^/]+(?:\/flow|\/realtime\/input|\/pvIVRealtime)?$/.test(path) ||
      /^\/api\/v1\/inverter\/(?:battery|grid|load)\/[^/]+\/realtime$/.test(path);
  }
  class Client {
    constructor({ transport, store, crypto, now = () => Date.now() }) {
      Object.assign(this, { transport, store, crypto, now }); this.inFlight = null;
    }
    async request(method, path, params = {}, body, token) {
      if (!allowed(method, path)) throw new Fault("route");
      const now = this.now(), cooldown = this.store.get("cooldown");
      if (cooldown && cooldown.until > now) throw new Fault(cooldown.kind, cooldown.until);
      let response;
      try { response = await this.transport({ method, path, params, body, token }); }
      catch (e) { if (e instanceof Fault) throw e; throw new Fault("network"); }
      const { status: http, json, headers = {} } = response;
      const code = number(json?.code);
      // Scriptable's Request normally exposes statusCode after loadString(), but
      // a runtime that omits it still has a TLS-verified, successfully parsed
      // envelope. Keep known HTTP failures authoritative; do not discard a
      // valid code: 0 response merely because that metadata is absent.
      const knownStatus = Number.isInteger(http) && http > 0;
      // Safe diagnostic metadata only. Never retain server messages or payloads.
      const fail = (kind, retry = 0) => {
        const error = new Fault(kind, retry);
        error.http = knownStatus ? http : null;
        error.code = code;
        error.dataType = json?.data === null ? "null" : Array.isArray(json?.data) ? "array" : typeof json?.data;
        return error;
      };
      if (code === 113 || code === 114) throw fail("interactive");
      if ((knownStatus && http === 429) || code === 429) {
        const until = retryAt(headers["Retry-After"] ?? headers["retry-after"], now);
        this.store.set("cooldown", { kind: "rate", until }); throw fail("rate", until);
      }
      if ((knownStatus && (http === 401 || http === 403)) || code === 401 || code === 403 || code === 102 || code === 101) throw fail("auth");
      if (knownStatus && http >= 500) throw fail("network");
      if ((knownStatus && (http < 200 || http >= 300)) || !json || code !== 0 || json.success === false || json.data === undefined || json.data === null) throw fail("protocol");
      return json.data;
    }
    saveToken(data, previousRefresh) {
      if (typeof data.access_token !== "string" || !data.access_token || /\s/.test(data.access_token)) throw new Fault("auth");
      if (data.token_type && String(data.token_type).toLowerCase() !== "bearer") throw new Fault("protocol");
      const lifetime = number(data.expires_in);
      if (lifetime !== null && lifetime <= 0) throw new Fault("auth");
      const token = { access: data.access_token, refresh: data.refresh_token || previousRefresh || null,
        expiresAt: lifetime !== null ? this.now() + lifetime * 1000 : null };
      this.store.set("token", token); return token;
    }
    async authenticate(force = false) {
      const cooldown = this.store.get("cooldown");
      if (cooldown && cooldown.until > this.now()) throw new Fault(cooldown.kind, cooldown.until);
      const token = this.store.get("token");
      if (!force && token?.access && (token.expiresAt === null || token.expiresAt - 60000 > this.now())) return token;
      if (this.inFlight) return this.inFlight;
      this.inFlight = this.obtain(token).finally(() => { this.inFlight = null; });
      return this.inFlight;
    }
    async obtain(old) {
      try {
        if (old?.refresh) {
          try {
            const data = await this.request("POST", "/oauth/token/new", {}, {
              grant_type: "refresh_token", refresh_token: old.refresh, client_id: "csp-web", source: "elinter"
            });
            return this.saveToken(data, old.refresh);
          } catch (e) {
            if (e.kind !== "auth" && e.kind !== "protocol") throw e;
            this.store.remove("token");
          }
        }
        const credentials = this.store.get("credentials");
        if (!credentials?.username || !credentials.password) throw new Fault("auth");
        const nonce = this.now(), query = `nonce=${nonce}&source=elinter`;
        const key = await this.request("GET", "/anonymous/publicKey", { nonce, source: "elinter", sign: this.crypto.md5(query + "POWER_VIEW") });
        if (typeof key !== "string" || key.length < 100) throw new Fault("protocol");
        const password = await this.crypto.encrypt(credentials.password, key);
        // Matches the live Inteless login module; no Sunsynk-specific token signature.
        const data = await this.request("POST", "/oauth/token/new", {}, {
          username: credentials.username, password, grant_type: "password", client_id: "csp-web", source: "elinter"
        });
        return this.saveToken(data);
      } catch (e) {
        if (["auth", "interactive"].includes(e.kind)) { this.store.remove("token"); this.store.set("cooldown", { kind: e.kind, until: this.now() + 30 * 60000 }); }
        throw e;
      }
    }
    async get(path, params = {}) {
      let token = await this.authenticate();
      try { return await this.request("GET", path, params, undefined, token.access); }
      catch (e) {
        if (e.kind !== "auth") throw e;
        const current = this.store.get("token");
        if (current?.access === token.access) {
          this.store.set("token", { ...current, expiresAt: 0 });
        }
        token = await this.authenticate();
        try { return await this.request("GET", path, params, undefined, token.access); }
        catch (again) {
          if (again.kind === "auth") { this.store.remove("token"); this.store.set("cooldown", { kind: "auth", until: this.now() + 30 * 60000 }); }
          throw again;
        }
      }
    }
    async list(path, params = {}) {
      const result = [], seen = new Set();
      for (let page = 1; page <= 50; page++) {
        const data = await this.get(path, { ...params, page, limit: 50 });
        if (!Array.isArray(data.infos)) throw new Fault("protocol");
        const signature = JSON.stringify(data.infos.map(x => x.sn ?? x.id));
        if (data.infos.length && seen.has(signature)) throw new Fault("pagination");
        seen.add(signature); result.push(...data.infos);
        const total = number(data.total);
        if (data.infos.length === 0 || (total !== null ? result.length >= total : data.infos.length < 50)) return result;
      }
      throw new Fault("pagination");
    }
    async readings(selection) {
      const sn = encodeURIComponent(selection.sn);
      const routes = { flow: `/api/v1/inverter/${sn}/flow`, detail: `/api/v1/inverter/${sn}`,
        pv: `/api/v1/inverter/${sn}/realtime/input`, battery: `/api/v1/inverter/battery/${sn}/realtime`, grid: `/api/v1/inverter/grid/${sn}/realtime` };
      const raw = {}, failures = [];
      // Sequential requests keep account traffic bounded and stop immediately on rate/auth failure.
      for (const [name, path] of Object.entries(routes)) {
        try {
          const data = await this.get(path, { sn: selection.sn, lan: "en" });
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Fault("protocol");
          raw[name] = data;
        } catch (e) {
          if (["auth", "interactive", "crypto", "rate", "network"].includes(e.kind)) throw e;
          failures.push(name);
        }
      }
      if (!Array.isArray(raw.pv?.pvIV)) {
        try {
          const extra = await this.get(`/api/v1/inverter/${sn}/pvIVRealtime`, { sn: selection.sn, lan: "en" });
          if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Fault("protocol");
          raw.pvExtra = extra;
        }
        catch (e) { if (["auth", "interactive", "crypto", "rate", "network"].includes(e.kind)) throw e; failures.push("pvExtra"); }
      }
      // The flow endpoint usually supplies load power, but the documented
      // load endpoint may be the only place with output/load voltage.
      const needsLoadPower = pick("W", raw.flow?.homeLoadPower, raw.flow?.loadOrEpsPower) === null;
      const needsLoadVoltage = pick("V", raw.flow?.loadVoltage, raw.flow?.loadVolt, raw.flow?.loadV) === null;
      if (needsLoadPower || needsLoadVoltage) {
        try {
          const load = await this.get(`/api/v1/inverter/load/${sn}/realtime`, { sn: selection.sn, lan: "en" });
          if (!load || typeof load !== "object" || Array.isArray(load)) throw new Fault("protocol");
          raw.load = load;
        }
        catch (e) {
          if (["auth", "interactive", "crypto", "rate", "network"].includes(e.kind)) throw e;
          // A missing optional voltage must not make valid flow readings look
          // stale. Report a partial result only when no load power is available.
          if (needsLoadPower) failures.push("load");
        }
      }
      if (!raw.flow && !raw.detail) throw new Fault("protocol");
      return { raw, failures };
    }
  }
  async function refresh({ client, cache, selection, preferences, now, force = false }) {
    const key = `${selection.plantId}:${selection.sn}`;
    let previous = null;
    try { previous = cache.read(key); } catch (_) { /* A corrupt cache is disposable. */ }
    if (previous?.version !== 1 || previous?.key !== key || !Number.isFinite(previous?.reading?.fetchedAt) || previous.reading.fetchedAt > now ||
        !Array.isArray(previous.reading.pvInputs) || !Array.isArray(previous.reading.gridVoltages) || !previous.reading.times ||
        !["batterySoc", "batteryVoltage", "batteryPower", "solarPower", "gridPower", "loadPower", "loadVoltage", "todayKwh"].every(field => previous.reading[field] === null || Number.isFinite(previous.reading[field]))) previous = null;
    let failure = null;
    try { failure = cache.failure?.(key); } catch (_) { /* Metadata is optional. */ }
    if (failure && failure.until > now) return { ...(previous || {}), reading: previous?.reading || null, error: failure.kind, cached: true, retryAt: failure.until };
    if (!force && previous && now - previous.reading.fetchedAt < POLL_MS) return { ...previous, cached: false, error: previous.partial ? "partial" : null, throttled: true };
    try {
      const result = await client.readings(selection);
      const reading = normalize(result.raw, preferences, now);
      if (!reading.hasReadings) throw new Fault("empty");
      const envelope = { version: 1, key, reading, partial: result.failures.length > 0 };
      // Never merge old fields into a newer snapshot: mixed-age values would look current.
      try { cache.write(key, envelope); cache.recordFailure?.(key, null); }
      catch (_) { return { ...envelope, error: "storage", cached: false }; }
      return { ...envelope, error: envelope.partial ? "partial" : null, cached: false };
    } catch (e) {
      const until = Math.max(now + POLL_MS, e.retryAt || 0);
      try { cache.recordFailure?.(key, { kind: e.kind || "network", until }); } catch (_) { /* Still render cache. */ }
      return { ...(previous || {}), reading: previous?.reading || null, error: e.kind || "network", cached: true, retryAt: until };
    }
  }
  function powerText(v, magnitude = false) {
    if (v === null || !Number.isFinite(v)) return "Unavailable";
    const n = magnitude ? Math.abs(v) : v;
    return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)} kW` : `${n.toFixed(0)} W`;
  }
  function valueText(v, unit, decimals = 1) { return v === null || !Number.isFinite(v) ? "Unavailable" : `${v.toFixed(decimals)}${unit}`; }
  function todayValue(reading, now, offsetMinutes) {
    if (!reading || day(reading.fetchedAt, offsetMinutes) !== day(now, offsetMinutes)) return null;
    const time = reading.times?.detail?.ms;
    if (time && day(time, offsetMinutes) !== day(now, offsetMinutes)) return null;
    return reading.todayKwh;
  }
  return { BASE, POLL_MS, STALE_MS, Fault, number, quantity, pick, day, timestamp, sourceTime, normalize, direction, status, retryAt, allowed, Client, refresh, powerText, valueText, todayValue };
})();
if (typeof module !== "undefined") module.exports = SolarCore;
