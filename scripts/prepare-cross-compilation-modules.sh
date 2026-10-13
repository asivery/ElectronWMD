if [ -e node_modules ]; then
    cd node_modules
    rm -rf @node-usb
    mkdir @node-usb
    cd @node-usb
    for x in usb-darwin-arm64 usb-darwin-x64 usb-win32-x64-msvc usb-linux-x64-gnu; do
        curl -L $(npm view @node-usb/$x dist.tarball) | tar xvzf -
        mv package $x
    done
else
    echo "Dependencies not installed - can't patch"
    exit 1
fi
