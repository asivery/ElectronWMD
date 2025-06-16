#!/bin/bash
if [ -d "renderer" ]; then
    echo "Renderer is present. It won't be rebuilt"
    exit
fi

cd webminidisc
npm i
PUBLIC_URL="sandbox://" npm run build; rm -rf ../renderer; cp -rv dist ../renderer
cd ..

