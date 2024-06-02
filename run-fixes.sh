#!/bin/bash

echo "Copying and patching WebMinidisc's interface declarations..."
cp webminidisc/src/services/interfaces/himd.ts webminidisc/src/services/interfaces/netmd.ts src/wmd/original/services/interfaces/
for x in src/wmd/original/services/interfaces/*
do
    sed -i -e '1i // This file has been auto-generated! DO NOT EDIT!' "$x"
    sed -i -E "s|^import Worker(.*)? from '[^']+';|const Worker\1 = null as any;|g" "$x"
    sed -i -e 's/import.meta.url/""/g' "$x"
done

PWD=$(pwd)
echo "Patching node-usb..."
cd node_modules/usb/dist/webusb
rm webusb-device.js
curl -O https://gist.githubusercontent.com/asivery/6688bcf656a0af5925674dd312ecb7b8/raw/e751f58aa10c14301ebce8580b1a07bcff41596b/webusb-device.js
cd "$PWD"

