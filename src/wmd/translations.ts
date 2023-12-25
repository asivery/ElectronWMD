import { HiMDFullService } from "./original/services/interfaces/himd";
import { Codec, NetMDUSBService, TitleParameter, WireformatDict } from "./original/services/interfaces/netmd";

import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import { DiscFormat, MDTrack } from "netmd-js";
import { concatUint8Arrays, sanitizeFullWidthTitle, sanitizeHalfWidthTitle } from "netmd-js/dist/utils";
import path from 'path';
import { Worker } from 'worker_threads';
import { makeAsyncWorker } from "himd-js/dist/node-crypto-worker";
import { DevicesIds, dumpTrack, generateCodecInfo, HiMDError, HiMDKBPSToFrameSize, HiMDWriteStream, UMSCHiMDFilesystem, UMSCHiMDSession, uploadMacDependent } from "himd-js";
import { WebUSBDevice, findByIds } from 'usb';
import { CryptoProvider } from "himd-js/dist/workers";

export class EWMDNetMD extends NetMDUSBService {
    override getWorkerForUpload() {
        return [new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'netmd-js', 'dist', 'node-encrypt-worker.js')
        ), makeGetAsyncPacketIteratorOnWorkerThread];
    }
}

export class EWMDHiMD extends HiMDFullService {
    override getWorker(): any[] {
        return [new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'himd-js', 'dist', 'node-crypto-worker.js')
        ), makeAsyncWorker];
    }
    
    async pair() {
        let legacyDevice;
        for(let { vendorId, deviceId } of DevicesIds){
            legacyDevice = findByIds(vendorId, deviceId);
            if(legacyDevice) break;
        }
        if(!legacyDevice) return false;

        legacyDevice.open();
        const iface = legacyDevice.interface(0);
        try{
            if(iface.isKernelDriverActive())
                iface.detachKernelDriver();
        }catch(ex){
            console.log("Couldn't detach the kernel driver. Expected on Windows.");
        }
        const webUsbDevice = await WebUSBDevice.createInstance(legacyDevice);
        await webUsbDevice.open();
        this.fsDriver = new UMSCHiMDFilesystem(webUsbDevice);
        return true;
    }
}
