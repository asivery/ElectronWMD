#!/bin/bash

PWD=$(pwd)
echo "Patching node-usb..."
cd node_modules/usb/dist/webusb
rm webusb-device.js
curl -O https://gist.githubusercontent.com/asivery/6688bcf656a0af5925674dd312ecb7b8/raw/e751f58aa10c14301ebce8580b1a07bcff41596b/webusb-device.js
cd "$PWD"

