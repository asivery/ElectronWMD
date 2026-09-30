const path = require('node:path');
const fs = require('node:fs');
const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const version = require('../electron-builder.test.json').electronVersion;
const target = path.resolve(__dirname, '..', 'build', `electron-${version}`);
(async () => {
    const archive = await downloadArtifact({ version, artifactName: 'electron', platform: 'darwin', arch: 'arm64' });
    fs.mkdirSync(target, { recursive: true });
    await extract(archive, { dir: target });
    console.log(path.join(target, 'Electron.app/Contents/MacOS/Electron'));
})().catch(error => { console.error(error); process.exitCode = 1; });
