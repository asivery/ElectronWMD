#!/usr/bin/env bash

# Usage: unix-unmount <VID> <PID>
# Author: asivery

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <VID> <PID>"
    exit 1
fi

VID="$1"
PID="$2"

function unmount_linux(){
    udevadm trigger -v -n -s block -p ID_VENDOR_ID=$VID -p ID_MODEL_ID=$PID | while IFS= read -r line; do
        device_name=$(basename "$line")
        umount "/dev/$device_name"
    done
}

function unmount_mac(){
    system_profiler SPUSBDataType | while IFS= read -r line; do
        line=$(xargs <<< "$line")
        if [[ $line =~ ^Vendor\ ID.* ]] ;
        then
            CUR_VID=$(cut -b 14-17 <<< $line)
            locked=n
        elif [[ $line =~ ^Product\ ID.* ]] ;
        then
            CUR_PID=$(cut -b 15-18 <<< $line)
        fi
        
        if [[ $line =~ ^Volumes:.* ]] ;
        then
            locked=y
        fi
        
        if [[ $line =~ ^BSD\ Name.* ]] && [[ $locked == "n" ]] ;
        then
            BSD_NAME=$(cut -b 10- <<< $line)
            if [[ "$CUR_PID" == "$PID" ]] && [[ "$CUR_VID" == "$VID" ]] ;
            then
                diskutil unmountDisk $BSD_NAME
            fi
        fi
    done
    
}

if [ "$(uname)" == "Linux" ]; then
    unmount_linux
elif [ "$(uname)" == "Darwin" ]; then
    unmount_mac
fi
