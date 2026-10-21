"""SYNTHETIC fixtures only. No cloud calls, credentials or account captures."""
import base64
import getpass
import importlib.util
import io
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("validator", Path(__file__).resolve().parents[1] / "phone" / "validate_inteless.py")
V = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(V)


class Response(io.BytesIO):
    def __init__(self, payload, code=200):
        super().__init__(json.dumps(payload).encode())
        self.code = code


class PhoneTests(unittest.TestCase):
    def test_explicit_context_ignores_unverified_default_override(self):
        with mock.patch.object(ssl, "_create_default_https_context", ssl._create_unverified_context):
            ctx = V.verified_context()
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)
        self.assertTrue(ctx.get_ca_certs())

    def test_getpass_fallback_is_fatal_before_any_echoed_input(self):
        with mock.patch.object(getpass, "getpass", side_effect=getpass.GetPassWarning()), self.assertRaises(V.Problem):
            V.hidden_input("NONSECRET TEST")

    def test_no_password_token_cli_arguments_or_disk_persistence(self):
        source = (Path(__file__).resolve().parents[1] / "phone" / "validate_inteless.py").read_text()
        self.assertNotIn('add_argument("--password', source)
        self.assertNotIn('add_argument("--token', source)
        self.assertNotIn('write_text(', source)
        self.assertNotIn('write_bytes(', source)

    def test_disallowed_route_never_reaches_transport(self):
        opener = mock.Mock()
        api = V.API(opener)
        with self.assertRaises(V.Problem):
            api.call("POST", "/api/v1/common/setting/S/set")
        opener.open.assert_not_called()

    def test_token_post_uses_the_current_json_media_type(self):
        opener = mock.Mock()
        opener.open.return_value = Response({"code": 0, "data": {}})
        V.API(opener).call("POST", "/oauth/token/new", body={}, authenticated=False)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Content-type"), "application/json;charset=UTF-8")

    def test_auth_interactive_rate_limit_and_redirect_are_safe(self):
        for code in (101, 102, 113, 114):
            opener = mock.Mock()
            opener.open.return_value = Response({"code": code, "msg": "PRIVATE-DETAIL-MUST-NOT-PRINT"})
            api = V.API(opener)
            with self.assertRaises(V.Problem) as err:
                api.call("POST", "/oauth/token/new", body={}, authenticated=False)
            self.assertNotIn("PRIVATE", str(err.exception))
        for http in (302, 401, 403, 429, 500):
            opener = mock.Mock()
            opener.open.return_value = Response({}, http)
            with self.assertRaises(V.Problem):
                V.API(opener).call("GET", "/anonymous/publicKey", authenticated=False)
        self.assertIsNone(V.NoRedirect().redirect_request(None, None, 302, None, {}, "https://evil.invalid"))

    def test_numeric_missing_not_zero(self):
        for value in (None, "", "--", True, False, "42 V", [], {}, float("nan")):
            self.assertIsNone(V.numeric(value))
        self.assertEqual(V.numeric("0"), 0)
        self.assertEqual(V.numeric("53.4"), 53.4)

    def test_reading_report_does_not_dump_extra_fields(self):
        output = io.StringIO()
        with mock.patch("sys.stdout", output):
            V.report_readings({"flow": {"soc": None, "pvPower": 0, "access_token": "NEVER-PRINT", "sn": "PRIVATE-ID"}})
        text = output.getvalue()
        self.assertIn("soc: Unavailable", text)
        self.assertIn("pvPower: 0 W", text)
        self.assertNotIn("NEVER-PRINT", text)
        self.assertNotIn("PRIVATE-ID", text)

    def test_token_expiry_and_refresh_values_remain_in_memory(self):
        api = V.API(mock.Mock())
        api.accept_token({"access_token": "SYNTHETIC-ACCESS", "expires_in": 7200})
        self.assertEqual(api.expiry_seconds, 7200)
        self.assertEqual(api.token["access_token"], "SYNTHETIC-ACCESS")

    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL needed for independent crypto interoperability")
    def test_public_rsa_interoperates_with_openssl_2048_and_4096(self):
        for bits in (2048, 4096):
            with self.subTest(bits=bits), tempfile.TemporaryDirectory() as folder:
                private = Path(folder) / "ephemeral-test-key.pem"
                subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:%d" % bits, "-out", str(private)], check=True, capture_output=True)
                public = subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout"], check=True, capture_output=True).stdout.decode()
                text = 'SYNTHETIC ☀️ café "</script>"'
                encrypted = V.rsa_encrypt(text, public)
                decrypted = subprocess.run(["openssl", "pkeyutl", "-decrypt", "-inkey", str(private), "-pkeyopt", "rsa_padding_mode:pkcs1"], input=base64.b64decode(encrypted), check=True, capture_output=True).stdout
                self.assertEqual(decrypted.decode(), text)
                self.assertNotEqual(encrypted, V.rsa_encrypt(text, public))
                with mock.patch.object(V.secrets, "token_bytes", side_effect=lambda n: bytes(n)), self.assertRaises(V.Problem):
                    V.rsa_encrypt("test", public)

    def test_malformed_public_key_rejected(self):
        for key in ("", "bad key!", "MIAA"):
            with self.assertRaises(V.Problem):
                V.rsa_encrypt("test", key)


if __name__ == "__main__":
    unittest.main()
