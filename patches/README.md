# Upstream USB compatibility patch

`usb-2.13.0-webusb-device.js` is the existing ElectronWMD macOS patch, vendored
without changes from the URL used by the v0.5.2-1.5.3 build scripts:

https://gist.githubusercontent.com/asivery/6688bcf656a0af5925674dd312ecb7b8/raw/e751f58aa10c14301ebce8580b1a07bcff41596b/webusb-device.js

SHA-256: `fe4d1e355d6c69f76594c0a4d1de7b513bf3098647a6a2a3c5f61da622e94569`

Upstream node-usb is MIT licensed; see `node_modules/usb/LICENSE`. This file is
not the shutdown fix. `scripts/prepare-dependencies.cjs` copies it only after
checking that the installed usb version is exactly 2.13.0. Vendoring preserves
the existing application behavior without downloading executable code on every build.
