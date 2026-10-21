// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: solar-panel;
// Inteless Solar — install this single file in Scriptable.
// Credentials are entered locally and stored in Scriptable Keychain.
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


// Small, original protocol helpers. MD5 is required by the server's public-key
// query signature; HTTPS and RSA provide credential transport protection.
const SolarCrypto = (() => {
  function md5(text) {
    const bytes = Array.from(unescape(encodeURIComponent(text)), c => c.charCodeAt(0));
    const bitLength = bytes.length * 8;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLength / 2 ** (8 * i)) & 255);
    const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
    let h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (let start = 0; start < bytes.length; start += 64) {
      const words = Array.from({ length: 16 }, (_, i) => bytes[start+i*4] | bytes[start+i*4+1]<<8 | bytes[start+i*4+2]<<16 | bytes[start+i*4+3]<<24);
      let [a,b,c,d] = h;
      for (let i = 0; i < 64; i++) {
        const round = Math.floor(i / 16);
        const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
        const g = round === 0 ? i : round === 1 ? (5*i+1)%16 : round === 2 ? (3*i+5)%16 : (7*i)%16;
        const x = (a + f + constants[i] + words[g]) | 0, s = shifts[round*4+i%4];
        const next = (b + ((x << s) | (x >>> (32-s)))) | 0;
        a = d; d = c; c = b; b = next;
      }
      h = h.map((v,i) => (v + [a,b,c,d][i]) | 0);
    }
    return h.map(v => [0,8,16,24].map(s => ((v >>> s) & 255).toString(16).padStart(2,"0")).join("")).join("");
  }
  // Self-contained so it can execute in an isolated local WKWebView with a
  // cryptographically secure random source. No downloaded scripts or pages.
  function rsaEncrypt(password, publicKey, randomBytes) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function decode(s) {
      s = s.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new Error("Invalid public key");
      let bits=0, value=0; const out=[];
      for (const c of s.replace(/=/g,"")) {
        value = (value<<6) | alphabet.indexOf(c); bits+=6;
        if (bits>=8) { bits-=8; out.push((value>>>bits)&255); }
      }
      return out;
    }
    function encode(bytes) {
      let out="";
      for(let i=0;i<bytes.length;i+=3) {
        const v=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);
        out+=alphabet[(v>>>18)&63]+alphabet[(v>>>12)&63]+(i+1<bytes.length?alphabet[(v>>>6)&63]:"=")+(i+2<bytes.length?alphabet[v&63]:"=");
      }
      return out;
    }
    const der=decode(publicKey);
    function tlv(pos) {
      const tag=der[pos++]; let len=der[pos++];
      if (len&128) {
        const count=len&127; if(!count||count>4) throw new Error("Invalid DER length");
        len=0; for(let i=0;i<count;i++)len=len*256+der[pos++];
      }
      if (!Number.isFinite(len)||pos+len>der.length) throw new Error("Invalid DER");
      return {tag,start:pos,end:pos+len};
    }
    let seq=tlv(0); if(seq.tag!==48)throw new Error("Invalid public key sequence");
    let item=tlv(seq.start);
    if(item.tag===48) { // SubjectPublicKeyInfo: algorithm OID followed by BIT STRING.
      const algorithm=der.slice(item.start,item.end).map(n=>n.toString(16).padStart(2,"0")).join("");
      if(algorithm!=="06092a864886f70d0101010500")throw new Error("Unsupported public key algorithm");
      const bit=tlv(item.end);if(bit.tag!==3||der[bit.start]!==0)throw new Error("Invalid key bit string");
      seq=tlv(bit.start+1);item=tlv(seq.start);
    }
    if(item.tag!==2)throw new Error("Invalid RSA modulus");
    let modulus=der.slice(item.start,item.end);while(modulus[0]===0)modulus.shift();
    const exp=tlv(item.end);if(exp.tag!==2)throw new Error("Invalid RSA exponent");
    const bigint=b=>BigInt("0x"+b.map(n=>n.toString(16).padStart(2,"0")).join(""));
    const n=bigint(modulus),e=bigint(der.slice(exp.start,exp.end)),k=modulus.length;
    if(k<256||k>1024||e<3n||e>4294967295n)throw new Error("Unsupported RSA key");
    const message=Array.from(unescape(encodeURIComponent(password)),c=>c.charCodeAt(0));
    if(message.length>k-11)throw new Error("Password too long for RSA key");
    const padding=[];let attempts=0;
    while(padding.length<k-message.length-3) {
      if(attempts++>20)throw new Error("Secure random failed");
      const random=randomBytes(k);
      if(!Array.isArray(random)&&!(random instanceof Uint8Array))throw new Error("Secure random unavailable");
      for(const b of random)if(Number.isInteger(b)&&b>0&&b<=255&&padding.length<k-message.length-3)padding.push(b);
    }
    let x=bigint([0,2,...padding,0,...message]),exponent=e,result=1n;
    while(exponent>0n){if(exponent&1n)result=result*x%n;x=x*x%n;exponent>>=1n;}
    let hex=result.toString(16).padStart(k*2,"0");
    return encode(Array.from({length:k},(_,i)=>parseInt(hex.slice(i*2,i*2+2),16)));
  }
  return { md5, rsaEncrypt };
})();


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
      plantName: plant.name || plant.plantName || "Solar installation",
      inverterName: rows[i].alias || "Inverter" };
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
  async function backfillPlantName(api, settings, selected) {
    if (selected?.plantName || !selected?.plantId) return;
    try {
      const plants = await api.list("/api/v1/plants");
      const plant = plants.find(x => String(x.id) === selected.plantId);
      const plantName = plant?.name || plant?.plantName;
      if (!plantName) return;
      selected.plantName = plantName;
      settings.selections = (settings.selections || []).map(x => `${x.plantId}:${x.sn}` === `${selected.plantId}:${selected.sn}` ? selected : x);
      if (`${settings.selection?.plantId}:${settings.selection?.sn}` === `${selected.plantId}:${selected.sn}`) settings.selection = selected;
      store.set("settings", settings);
    } catch (_) { /* Keep the current widget usable if this one-time migration cannot complete. */ }
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
    const width = 620, height = 310, left = 30, right = 9, powerTop = 44, powerBottom = 215, socTop = 238, socBottom = 292;
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
    ctx.drawTextInRect("PV", new Rect(left, 10, 22, 14)); ctx.drawTextInRect("Load", new Rect(left + 35, 10, 34, 14));
    ctx.setTextColor(new Color(PALETTE.battery)); ctx.drawTextInRect("Batt", new Rect(left + 78, 10, 31, 14));
    ctx.setTextColor(new Color(PALETTE.grid)); ctx.drawTextInRect("Grid", new Rect(left + 119, 10, 32, 14));
    ctx.setTextColor(new Color(PALETTE.bright)); ctx.drawTextInRect("SOC", new Rect(left + 160, 10, 28, 14));
    ctx.setTextColor(new Color(PALETTE.muted)); ctx.setFont(Font.systemFont(9));
    ctx.drawTextInRect("±" + SolarCore.powerText(maxPower, true), new Rect(width - 75, powerTop - 10, 70, 13));
    ctx.drawTextInRect("0%", new Rect(2, socBottom - 9, 24, 12)); ctx.drawTextInRect("100%", new Rect(0, socTop - 2, 30, 12));
    return ctx.getImage();
  }
  function freshness(w, r, settings) {
    const row = w.addStack(); row.layoutHorizontally(); row.spacing = 2;
    if (!r.sourceAt) {
      text(row, "Cloud age unavailable", 8, PALETTE.warning).lineLimit = 1;
    } else {
      text(row, "Cloud ", 8, PALETTE.muted).lineLimit = 1;
      const sourceAge = row.addDate(new Date(r.sourceAt)); sourceAge.applyRelativeStyle(); sourceAge.font = Font.systemFont(8); sourceAge.textColor = new Color(PALETTE.muted); sourceAge.minimumScaleFactor = 0.5;
    }
    text(row, " · Fetch ", 8, PALETTE.bright).lineLimit = 1;
    const fetchedAge = row.addDate(new Date(r.fetchedAt)); fetchedAge.applyRelativeStyle(); fetchedAge.font = Font.systemFont(8); fetchedAge.textColor = new Color(PALETTE.bright); fetchedAge.minimumScaleFactor = 0.5;
  }
  function widget(state, selected, settings, family = "large", now = Date.now()) {
    const w = new ListWidget(); w.setPadding(8, 12, 8, 12); w.spacing = 3;
    w.backgroundColor = new Color(PALETTE.ink);
    w.refreshAfterDate = new Date(Math.max(now + SolarCore.POLL_MS, state.retryAt || 0));
    w.url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name());
    const r = state.reading;
    const header = w.addStack(); header.layoutHorizontally();
    text(header, state.demo ? "DEMO" : (selected?.plantName || "Solar installation"), 11, PALETTE.bright, true).lineLimit = 1;
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
      freshness(w, r, settings);
    } else {
      metricGrid(w, r);
      if (family === "large") {
        const image = chart(state.history || []);
        if (image) { const graph = w.addImage(image); graph.imageSize = new Size(310, 155); }
        else text(w, "Trend chart begins after two on-device refresh samples.", 9, PALETTE.muted).lineLimit = 1;
        const today = SolarCore.todayValue(r, now, settings.utcOffsetMinutes);
        text(w, `Grid ${SolarCore.powerText(r.gridPower, true)} ${r.gridDirection} · ${voltages(r.pvInputs)} · Today ${SolarCore.valueText(today, " kWh", 2)}`, 8, PALETTE.muted).lineLimit = 1;
      }
      freshness(w, r, settings);
      if (family === "large") w.addSpacer();
    }
    return w;
  }
  async function getState(settings, selected, force = false) {
    const local = cache(settings.scope);
    const api = client();
    const state = await SolarCore.refresh({ client: api, cache: local, selection: selected, preferences: settings, now: Date.now(), force });
    if (!state.error && !state.cached) await backfillPlantName(api, settings, selected);
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

await runSolarWidget();
