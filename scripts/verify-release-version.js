const fs = require('node:fs');
const path = require('node:path');

const tag = process.argv[2];
const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag || '')) throw new Error(`Expected a semantic release tag, received ${tag || '(missing)'}.`);
if (tag !== `v${version}`) throw new Error(`Release tag ${tag} does not match package.json version v${version}.`);
console.log(`Release tag ${tag} matches package version ${version}.`);
