"""Package only an explicit list of public project deliverables, never local data."""
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "scriptable/Inteless Solar.js": "scriptable/Inteless Solar.js",
    "phone/validate_inteless.py": "phone/validate_inteless.py",
    "README.md": "README.md",
    "docs/RESEARCH.md": "docs/RESEARCH.md",
    "docs/VALIDATION.md": "docs/VALIDATION.md",
    "LICENSE": "LICENSE",
    "reports/iPhone solar widget platform decision.md": "reports/iPhone solar widget platform decision.md",
}


def package():
    target = ROOT / "dist" / "IntelessSolar-iPhone.zip"
    target.parent.mkdir(exist_ok=True)
    manifest = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, relative in FILES.items():
            data = (ROOT / relative).read_bytes()
            archive.writestr(name, data)
            manifest.append(hashlib.sha256(data).hexdigest() + "  " + name)
        archive.writestr("SHA256SUMS.txt", "\n".join(manifest) + "\n")
    print("Packaged " + str(target))


if __name__ == "__main__":
    package()
