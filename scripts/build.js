const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const parts = ['core', 'crypto', 'scriptable'].map(name => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8').replace(/^if \(typeof module !== "undefined"\) module.exports = .*;$/gm, ''));
const header = '// Variables used by Scriptable.\n// icon-color: deep-green; icon-glyph: solar-panel;\n// Inteless Solar — install this single file in Scriptable.\n// Credentials are entered locally and stored in Scriptable Keychain.\n';
fs.writeFileSync(path.join(root, 'scriptable', 'Inteless Solar.js'), header + parts.join('\n') + '\nawait runSolarWidget();\n');
console.log('Built scriptable/Inteless Solar.js');
