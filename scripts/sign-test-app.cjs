const path = require('node:path');
const { execFileSync } = require('node:child_process');
const app = path.resolve(__dirname, '../build/shutdown-test/mac-arm64/ElectronWMD Shutdown Test.app');
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
