#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

if [ "$(uname)" == "Linux" ]; then
    SED=sed
elif [ "$(uname)" == "Darwin" ]; then
    SED=gsed
fi


echo "Copying and patching WebMinidisc's interface declarations..."
cp webminidisc/src/services/interfaces/himd.ts webminidisc/src/services/interfaces/netmd.ts src/wmd/original/services/interfaces/
for x in src/wmd/original/services/interfaces/*
do
    $SED -i -e '1i // This file has been auto-generated! DO NOT EDIT!' "$x"
    $SED -i -E "s|^import Worker(.*)? from '[^']+';|const Worker\1 = null as any;|g" "$x"
    $SED -i -e 's/import.meta.url/""/g' "$x"
done
