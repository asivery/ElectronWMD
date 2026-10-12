import { HiMDFullService } from "./original/services/interfaces/himd";
import { NetMDUSBService } from "./original/services/interfaces/netmd";

import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import path from 'path';
import { Worker } from 'worker_threads';
import { makeAsyncWorker, makeAsyncCryptoBlockProvider } from "himd-js/dist/node-crypto-worker";
import { DevicesIds, UMSCHiMDFilesystem } from "himd-js";
import { UsbDevice, nativeFindDeviceByIds } from 'usb/index';
import { unmountAll } from "../unmount-drives";

export class EWMDNetMD extends NetMDUSBService {
    override getWorkerForUpload() {
        return [new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'netmd-js', 'dist', 'node-encrypt-worker.js')
        ), makeGetAsyncPacketIteratorOnWorkerThread] as any;
    }
}

export class EWMDHiMD extends HiMDFullService {
    public fsDriver?: UMSCHiMDFilesystem;
    public deviceConnectedCallback?: (key: string, device: UsbDevice) => void

    override getWorker(): any[] {
        return [new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'himd-js', 'dist', 'node-crypto-worker.js')
        ), makeAsyncWorker, makeAsyncCryptoBlockProvider];
    }

    async pair() {
        this.bypassFSCoherencyChecks = true; // process.env.EWMD_HIMD_BYPASS_COHERENCY_CHECK === 'true';
        if(this.bypassFSCoherencyChecks) {
            console.log("Warning: All FAT filesystem coherency checks are bypassed!\nThis might cause data corruption!")
        }
        let webUsbDevice: UsbDevice | null = null, vendorId, deviceId;
        for({ vendorId, deviceId } of DevicesIds){
            webUsbDevice = await nativeFindDeviceByIds(vendorId, deviceId);
            if(webUsbDevice) break;
        }
        if(!webUsbDevice) return false;

        if(['darwin', 'linux'].includes(process.platform)){
            await unmountAll(vendorId!, deviceId!);
        }

        webUsbDevice.open();
        try{
            webUsbDevice.detachKernelDriver(0);
        }catch(ex){
            console.log("Couldn't detach the kernel driver. Expected on Windows.");
        }
        await webUsbDevice.open();
        if(process.platform === 'linux') {
            // TODO: Check windows.
            // Resetting on MacOS reattaches the system driver.
            await webUsbDevice.reset();
        }
        this.deviceConnectedCallback?.(webUsbDevice.serialNumber ?? 'himd', webUsbDevice);
        this.fsDriver = new UMSCHiMDFilesystem(webUsbDevice);
        return true;
    }
}
