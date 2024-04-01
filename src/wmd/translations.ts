import { HiMDFullService } from "./original/services/interfaces/himd";
import { NetMDUSBService } from "./original/services/interfaces/netmd";

import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import path from 'path';
import { Worker } from 'worker_threads';
import { makeAsyncWorker } from "himd-js/dist/node-crypto-worker";
import { DevicesIds, UMSCHiMDFilesystem } from "himd-js";
import { WebUSBDevice, findByIds } from 'usb';
import { unmountAll } from "../unmount-drives";

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
        let legacyDevice, vendorId, deviceId;
        for({ vendorId, deviceId } of DevicesIds){
            legacyDevice = findByIds(vendorId, deviceId);
            if(legacyDevice) break;
        }
        if(!legacyDevice) return false;

        if(['darwin', 'linux'].includes(process.platform)){
            await unmountAll(vendorId, deviceId);
        }

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
