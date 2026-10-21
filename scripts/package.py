"""Package only an explicit list of public project deliverables, never local data."""
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "Inteless Solar.js": "scriptable/Inteless Solar.js",
    "README.md": "docs/SCRIPTABLE_SETUP.md",
    "docs/RESEARCH.md": "docs/RESEARCH.md",
    "docs/VALIDATION.md": "docs/VALIDATION.md",
    "LICENSE": "LICENSE",
}


def package():
    target = ROOT / "dist" / "IntelessSolar-Widget.zip"
    target.parent.mkdir(exist_ok=True)
    manifest = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, relative in FILES.items():
            data = (ROOT / relative).read_bytes()
            archive.writestr(name, data)
            manifest.append(hashlib.sha256(data).hexdigest() + "  " + name)
        archive.writestr("SHA256SUMS.txt", "\n".join(manifest) + "\n")
    print("Packaged " + str(target))
    # Separate optional diagnostic, never a dependency in the widget archive.
    diagnostic = target.parent / "validate_inteless.py"
    diagnostic.write_bytes((ROOT / "phone" / "validate_inteless.py").read_bytes())
    print("Optional a-Shell diagnostic: " + str(diagnostic))


if __name__ == "__main__":
    package()
