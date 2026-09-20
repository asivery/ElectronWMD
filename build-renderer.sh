#!/bin/bash
if [ -d "renderer" ]; then
    echo "Renderer is present. It won't be rebuilt"
    exit
fi

cd webminidisc
npm i --allow-git=root
PUBLIC_URL="sandbox://app/" npm run build; rm -rf ../renderer; cp -rv dist ../renderer
cd ..

