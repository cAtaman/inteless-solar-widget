#!/usr/bin/env python3
"""Read-only, dependency-free Inteless check for a-Shell. No secret persistence.

Run --probe first. Run without arguments only when ready to sign in locally.
There are deliberately no password/token command-line arguments or raw dumps.
"""
import argparse
import base64
import getpass
import hashlib
import json
import math
import os
import platform
import re
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings

BASE = "https://pv.inteless.com"
TIMEOUT = 15
MAX_RESPONSE = 2 * 1024 * 1024


class Problem(Exception):
    """Fixed, safe messages only: never include a response or request body."""


def md5(text):
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def rsa_encrypt(password, public_key):
    """Only RSA public encryption, PKCS#1 v1.5, using the OS CSPRNG.

    No private-key operations. Restricted DER reader accepts RSA SPKI or PKCS#1.
    Interoperability is independently tested against OpenSSL (2048/4096 bits).
    """
    text = re.sub(r"-----[^-]+-----|\s", "", public_key)
    try:
        der = base64.b64decode(text, validate=True)
    except (ValueError, TypeError):
        raise Problem("Invalid public key encoding") from None
    if len(der) > 2048:
        raise Problem("Unsupported public key size")

    def item(pos, boundary):
        if pos + 2 > boundary:
            raise Problem("Invalid public key DER")
        tag, length = der[pos], der[pos + 1]
        pos += 2
        if length & 128:
            count = length & 127
            if not 1 <= count <= 4 or pos + count > boundary:
                raise Problem("Invalid public key length")
            length = int.from_bytes(der[pos:pos + count], "big")
            pos += count
        if pos + length > boundary:
            raise Problem("Truncated public key")
        return tag, pos, pos + length

    tag, start, end = item(0, len(der))
    if tag != 48 or end != len(der):
        raise Problem("Invalid public key sequence")
    tag, a, b = item(start, end)
    if tag == 48:
        if der[a:b].hex() != "06092a864886f70d0101010500":
            raise Problem("Unsupported public key algorithm")
        tag, a, b = item(b, end)
        if tag != 3 or b != end or a >= b or der[a] != 0:
            raise Problem("Invalid public key bit string")
        tag, start, seq_end = item(a + 1, b)
        if tag != 48 or seq_end != b:
            raise Problem("Invalid RSA sequence")
        end = seq_end
        tag, a, b = item(start, end)
    if tag != 2:
        raise Problem("Missing RSA modulus")
    modulus = der[a:b].lstrip(b"\0")
    tag, a, b = item(b, end)
    if tag != 2 or b != end:
        raise Problem("Missing RSA exponent")
    n, e, width = int.from_bytes(modulus, "big"), int.from_bytes(der[a:b], "big"), len(modulus)
    if width not in (256, 384, 512) or e < 3 or e > 0xffffffff or e % 2 == 0 or n % 2 == 0:
        raise Problem("Unsupported RSA key")
    message = password.encode("utf-8")
    if len(message) > width - 11:
        raise Problem("Password is too long for the server key")
    padding = bytearray()
    for _ in range(32):
        padding.extend(x for x in secrets.token_bytes(width) if x)
        if len(padding) >= width - len(message) - 3:
            break
    padding = padding[:width - len(message) - 3]
    if len(padding) != width - len(message) - 3:
        raise Problem("Secure randomness failed")
    block = b"\0\2" + padding + b"\0" + message
    encrypted = pow(int.from_bytes(block, "big"), e, n).to_bytes(width, "big")
    return base64.b64encode(encrypted).decode("ascii")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def allowed(method, path):
    if method == "POST":
        return path == "/oauth/token/new"
    if method != "GET":
        return False
    return path in ("/anonymous/publicKey", "/api/v1/plants") or bool(re.fullmatch(
        r"/api/v1/plant/[^/]+/inverters|/api/v1/inverter/[^/]+(?:/flow|/realtime/input)?|/api/v1/inverter/(?:battery|grid)/[^/]+/realtime", path))


def verified_context():
    # Construct directly: do not trust a host app's overridden default factory.
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.check_hostname = True
    ctx.load_default_certs()
    if not ctx.get_ca_certs():
        raise Problem("No trusted CA certificates available; HTTPS check stopped")
    return ctx


class API:
    def __init__(self, opener=None):
        self.opener = opener or urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPSHandler(context=verified_context()),
            urllib.request.ProxyHandler({}))
        self.token = None
        self.expiry_seconds = None
        self.calls = 0
        self.cooldown = 0

    def call(self, method, path, params=None, body=None, authenticated=True):
        if not allowed(method, path):
            raise Problem("Blocked route outside monitoring allowlist")
        if time.time() < self.cooldown:
            raise Problem("Rate limited; wait until the retry time")
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        headers = {"Accept": "application/json", "Accept-Language": "en"}
        if authenticated:
            if not self.token:
                raise Problem("Sign in required")
            headers["Authorization"] = "Bearer " + self.token["access_token"]
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        self.calls += 1
        try:
            response = self.opener.open(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as err:
            response = err  # Handle status without printing the response body.
        except (urllib.error.URLError, TimeoutError, OSError):
            raise Problem("Network/TLS failure; no response details logged") from None
        with response:
            status = response.code
            if status == 429:
                self.cooldown = time.time() + 600
                raise Problem("Rate limited; wait at least 10 minutes")
            if status in (401, 403):
                raise Problem("Session rejected; sign in again locally")
            if 300 <= status < 400:
                raise Problem("Redirect rejected; credentials were not forwarded")
            if status != 200:
                raise Problem("Cloud HTTP failure (status %d)" % status)
            content = response.read(MAX_RESPONSE + 1)
            if len(content) > MAX_RESPONSE:
                raise Problem("Response exceeded size limit")
        try:
            payload = json.loads(content)
        except (ValueError, UnicodeError):
            raise Problem("Cloud did not return valid JSON") from None
        if not isinstance(payload, dict):
            raise Problem("Unexpected response shape")
        code = payload.get("code")
        if code in (101, 102, 113, 114, 401, 403):
            raise Problem({113: "Account requires a password change in the official app/site",
                           114: "Account requires interactive email verification in the official app/site"}.get(
                               code, "Authentication rejected; check your account in the official app/site"))
        if code == 429:
            self.cooldown = time.time() + 600
            raise Problem("Rate limited; wait at least 10 minutes")
        if code != 0 or payload.get("success") is False or payload.get("data") is None:
            raise Problem("Cloud schema/rejection (code %s)" % (code if isinstance(code, int) else "unknown"))
        return payload["data"]

    def key(self):
        nonce = int(time.time() * 1000)
        data = self.call("GET", "/anonymous/publicKey", {
            "nonce": nonce, "source": "elinter", "sign": md5("nonce=%s&source=elinterPOWER_VIEW" % nonce)
        }, authenticated=False)
        if not isinstance(data, str):
            raise Problem("Unexpected public key response")
        # Validate parsing/randomness with public nonsecret text before any password.
        rsa_encrypt("capability-check", data)
        return data

    def accept_token(self, data):
        if not isinstance(data, dict) or not isinstance(data.get("access_token"), str) or not data["access_token"] or re.search(r"\s", data["access_token"]):
            raise Problem("Login returned no usable token")
        if data.get("token_type", "bearer").lower() != "bearer":
            raise Problem("Unsupported token type")
        self.token = data
        self.expiry_seconds = numeric(data.get("expires_in"))

    def login(self, username, password, key):
        encrypted = rsa_encrypt(password, key)
        self.accept_token(self.call("POST", "/oauth/token/new", body={
            "username": username, "password": encrypted, "grant_type": "password",
            "client_id": "csp-web", "source": "elinter"
        }, authenticated=False))

    def refresh(self):
        if not self.token or not self.token.get("refresh_token"):
            raise Problem("No refresh token returned; background refresh remains unvalidated")
        previous_refresh = self.token["refresh_token"]
        self.accept_token(self.call("POST", "/oauth/token/new", body={
            "grant_type": "refresh_token", "refresh_token": previous_refresh,
            "client_id": "csp-web", "source": "elinter"
        }, authenticated=False))
        if not self.token.get("refresh_token"):
            self.token["refresh_token"] = previous_refresh

    def listing(self, path, params=None):
        result, seen = [], set()
        for page in range(1, 51):
            data = self.call("GET", path, dict(params or {}, page=page, limit=50))
            if not isinstance(data, dict) or not isinstance(data.get("infos"), list):
                raise Problem("Enumeration schema changed")
            rows = data["infos"]
            signature = tuple(str(x.get("sn", x.get("id"))) for x in rows if isinstance(x, dict))
            if rows and signature in seen:
                raise Problem("Server repeated a page; selection stopped")
            seen.add(signature)
            result.extend(rows)
            total = numeric(data.get("total"))
            if not rows or (total is not None and len(result) >= total) or (total is None and len(rows) < 50):
                return result
        raise Problem("Too many enumeration pages")


def numeric(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    if isinstance(value, str) and not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)", value.strip()):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError, OverflowError):
        return None


def hidden_input(prompt):
    # getpass normally falls back to echoed input. Make that warning fatal first.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            return getpass.getpass(prompt)
        except (getpass.GetPassWarning, OSError):
            raise Problem("Masked input unavailable in this host. Stop here; use Scriptable secure setup instead.") from None


def choose(title, items, label):
    if not items:
        raise Problem("No %s available on this account/host" % title)
    print("\nSelect %s (shown locally only):" % title)
    for i, row in enumerate(items, 1):
        print("  %d. %s" % (i, label(row)))
    if len(items) == 1:
        return items[0]
    try:
        choice = int(input("Number: "))
        if 1 <= choice <= len(items):
            return items[choice - 1]
    except ValueError:
        pass
    raise Problem("Invalid selection; stopped")


def probe(network=False):
    ctx = verified_context()
    print("CAPABILITY CHECK — no account login")
    print("Python: %s; host: %s" % (platform.python_version(), os.environ.get("APPNAME", platform.system())))
    print("a-Shell version: %s" % os.environ.get("APPVERSION", "not exposed"))
    print("Target: user's iPhone 12 / iOS 27; actual widget behavior NOT tested")
    print("TLS: certificate verification=%s, hostname checking=%s" % (ctx.verify_mode == ssl.CERT_REQUIRED, ctx.check_hostname))
    print("CSPRNG: %s" % (len(secrets.token_bytes(32)) == 32))
    if network:
        API().key()
        print("Anonymous public key + RSA encryption: PASS (no account login)")
    print("Secrets: never written to disk; masked input checked only when prompted")


def report_readings(raw):
    print("\nACTUAL ACCOUNT RESPONSE — interpretation still needs comparison with AlpSolarr")
    for name, data in raw.items():
        print("%s endpoint: returned JSON; known scalar readings below" % name)
        fields = {"flow": [("soc", "%"), ("battV", "V"), ("battPower", "W, raw sign"), ("pvPower", "W"), ("gridOrMeterPower", "W, raw sign"), ("loadOrEpsPower", "W, Load/EPS"), ("homeLoadPower", "W, household")],
                  "detail": [("etoday", "kWh")], "battery": [("soc", "%"), ("voltage", "V"), ("power", "W, raw sign")], "pv": [("pac", "W")], "grid": [("pac", "W, raw sign")]}.get(name, [])
        for field, unit in fields:
            value = numeric(data.get(field))
            print("  %s: %s" % (field, "Unavailable" if value is None else "%g %s" % (value, unit)))
        for array_key, value_key, prefix in [("pvIV", "vpv", "PV"), ("vip", "volt", "L")]:
            rows = data.get(array_key)
            if isinstance(rows, list):
                for i, row in enumerate(rows, 1):
                    v = numeric(row.get(value_key)) if isinstance(row, dict) else None
                    print("  %s%d voltage: %s" % (prefix, i, "Unavailable" if v is None else "%g V" % v))
        # Output only expected numeric/boolean flags, never arbitrary server messages.
        for key in ["batTo", "toBat", "gridTo", "toGrid", "existsThreeLoad", "connected", "status"]:
            if isinstance(data.get(key), (bool, int, float)):
                print("  %s: %s (compare semantics with app)" % (key, data[key]))
        times = [key for key in ("time", "timestamp", "updateAt", "collectTime") if key in data]
        print("  Timestamp fields present: %s" % (", ".join(times) or "none recognized; age UNKNOWN"))
    print("\nNo raw responses, identifiers, tokens or credentials were saved.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true", help="capabilities only, no credential prompt")
    parser.add_argument("--network", action="store_true", help="also check anonymous public-key service during probe")
    parser.add_argument("--refresh-test", action="store_true", help="explicitly test one refresh grant after login")
    args = parser.parse_args()
    probe(args.network if args.probe else False)
    if args.probe:
        return
    api = API()
    key = api.key()
    print("\nOnly pv.inteless.com authentication and read-only monitoring routes will be used.")
    print("No credentials in commands. Use your own authorized account only.")
    # Require the user to exercise masked input with nonsecret text first.
    hidden_input("Masked-input check: type only the word test (should be invisible): ")
    username = hidden_input("Account username/email (hidden): ").strip()
    password = hidden_input("Account password (hidden): ")
    try:
        api.login(username, password, key)
    finally:
        password = username = None  # Best effort; Python cannot promise memory zeroization.
    print("Login accepted. Token values are not displayed.")
    print("expires_in: %s" % ("not supplied; no expiry assumed" if api.expiry_seconds is None else "%g seconds" % api.expiry_seconds))
    if args.refresh_test:
        api.refresh()
        print("One immediate refresh grant accepted; expiry recovery is NOT proven by this alone.")
    plant = choose("plant", api.listing("/api/v1/plants"), lambda x: str(x.get("name") or x.get("plantName") or x.get("id")))
    plant_id = str(plant.get("id", ""))
    if not plant_id:
        raise Problem("Plant identifier missing")
    inverter = choose("inverter", api.listing("/api/v1/plant/%s/inverters" % urllib.parse.quote(plant_id, safe=""),
                      {"status": -1, "type": -2, "id": plant_id}), lambda x: str(x.get("alias") or x.get("sn")))
    serial = str(inverter.get("sn", ""))
    if not serial:
        raise Problem("Inverter serial missing")
    sn = urllib.parse.quote(serial, safe="")
    routes = {"flow": "/api/v1/inverter/%s/flow" % sn, "detail": "/api/v1/inverter/%s" % sn,
              "pv": "/api/v1/inverter/%s/realtime/input" % sn, "battery": "/api/v1/inverter/battery/%s/realtime" % sn,
              "grid": "/api/v1/inverter/grid/%s/realtime" % sn}
    raw = {}
    for name, path in routes.items():
        data = api.call("GET", path, {"sn": serial, "lan": "en"})
        if not isinstance(data, dict):
            raise Problem("Telemetry response shape changed")
        raw[name] = data
    report_readings(raw)
    api.token = None
    print("Next: compare readings with AlpSolarr, then run Scriptable setup. This script is not the widget.")


if __name__ == "__main__":
    try:
        main()
    except Problem as exc:
        print("STOP: %s" % exc, file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("Stopped; no credentials saved.", file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Do not let host/library exceptions dump a request, token or password.
        print("STOP: unexpected host error; details suppressed to protect credentials.", file=sys.stderr)
        sys.exit(1)
