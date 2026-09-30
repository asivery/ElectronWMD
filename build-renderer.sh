#!/bin/bash
set -euo pipefail
if [ -d "renderer" ] && [ "${1:-}" != "--force" ]; then
    echo "Renderer is present. It won't be rebuilt"
    exit
fi

cd webminidisc
npm ci --no-audit --no-fund
PUBLIC_URL="sandbox://" npm run build
# Build succeeds before replacing the previous renderer.
rm -rf ../renderer.previous
if [ -d ../renderer ]; then mv ../renderer ../renderer.previous; fi
cp -R dist ../renderer
rm -rf ../renderer.previous
cd ..
