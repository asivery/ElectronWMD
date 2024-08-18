#!/bin/bash
if [ -d "renderer" ]; then
    echo "Renderer is present. It won't be rebuilt"
    exit
fi

rm -rf webminidisc

git clone https://github.com/asivery/webminidisc
cd webminidisc
npm i
PUBLIC_URL="sandbox://" npm run build; rm -rf ../renderer; cp -rv dist ../renderer
cd ..

