const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactName = 'Inteless-Solar.js';
const source = path.join(dist, artifactName);

if (!fs.existsSync(source)) throw new Error('Build the Scriptable artifact before packaging a release.');
const artifact = fs.readFileSync(source);
const digest = crypto.createHash('sha256').update(artifact).digest('hex');
fs.writeFileSync(path.join(dist, `${artifactName}.sha256`), `${digest}  ${artifactName}\n`);
fs.writeFileSync(path.join(dist, 'scriptable-gallery-submission.md'), `# Inteless Solar v${packageJson.version}\n\nTitle: Inteless Solar\n\nDescription: Read-only PV Inteless monitoring widget for Scriptable, iOS Home Screen, and Siri Shortcuts.\n\nLicense: MIT\n\nInstallable script: ${artifactName}\n\nThe Scriptable Gallery is curated and has no documented upload API. Submit this release asset through the Gallery's current contributor process; do not upload account data, screenshots, or credentials.\n`);
console.log(`Packaged dist/${artifactName} v${packageJson.version} (sha256 ${digest})`);
