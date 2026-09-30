// Keep the upstream macOS compatibility patch offline and version checked.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const usb = require(path.join(root, 'node_modules/usb/package.json'));
if (usb.version !== '2.13.0') throw new Error(`Review USB patch compatibility before using usb ${usb.version}`);
fs.copyFileSync(path.join(root, 'patches/usb-2.13.0-webusb-device.js'),
    path.join(root, 'node_modules/usb/dist/webusb/webusb-device.js'));
