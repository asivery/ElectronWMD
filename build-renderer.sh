#!/bin/bash
if [ -d "renderer" ]; then
    echo "Renderer is present. It won't be rebuilt"
    exit
fi

rm -rf webminidisc

git clone https://github.com/cybercase/webminidisc
cd webminidisc
npm i
PUBLIC_URL="sandbox://" REACT_APP_NO_GA_RELEASE="true" npm run build; rm -rf ../renderer; cp -rv build ../renderer
cd ..

