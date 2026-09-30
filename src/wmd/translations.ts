import { HiMDFullService } from "./original/services/interfaces/himd";
import { NetMDUSBService } from "./original/services/interfaces/netmd";

import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import path from 'path';
import { Worker } from 'worker_threads';
import { makeAsyncWorker, makeAsyncCryptoBlockProvider } from "himd-js/dist/node-crypto-worker";
import { DevicesIds, UMSCHiMDFilesystem } from "himd-js";
import { WebUSBDevice, findByIds, usb } from 'usb';
import { unmountAll } from "../unmount-drives";
import { WebUSBInterop } from '../wusb-interop';

export class EWMDNetMD extends NetMDUSBService {
    async shutdown(): Promise<void> {
        clearInterval(this.statusMonitorTimer);
        if (this.currentSession) await this.finalizeUpload();
        await this.finalize();
    }

    override async finalize(): Promise<void> {
        if (!this.netmdInterface) return;
        // The upstream finalize catches reset failure and skips close. Close the
        // WebUSB handle explicitly, while the libusb context is still alive.
        await (navigator.usb as WebUSBInterop).closeDevice(device => this.isDeviceConnected(device), true);
        this.netmdInterface = undefined;
        this.dropCachedContentList();
    }

    override getWorkerForUpload() {
        return [new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'netmd-js', 'dist', 'node-encrypt-worker.js')
        ), makeGetAsyncPacketIteratorOnWorkerThread] as any;
    }
}

export class EWMDHiMD extends HiMDFullService {
    public fsDriver?: UMSCHiMDFilesystem;
    public deviceConnectedCallback?: (legacy: usb.Device, webusb: WebUSBDevice) => {}
    private usbDevice?: WebUSBDevice;

    async shutdown(): Promise<void> {
        // Do not close the device after a failed flush/sign operation: retain it
        // for retry so the pending metadata can still be committed.
        if (this.atdata) await this.finalizeUpload();
        if (this.session) {
            await this.session.finalizeSession();
            this.session = null;
        }
        this.streamingWorker?.close();
        this.streamingWorker = null;
        if (this.himd?.isDirty()) await this.flush();
        await this.finalize();
    }

    override async finalize(): Promise<void> {
        if (this.usbDevice) await (navigator.usb as WebUSBInterop).closeDevice(device => device === this.usbDevice);
        this.usbDevice = undefined;
        this.fsDriver = undefined;
    }

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
        let legacyDevice: any, vendorId, deviceId;
        for({ vendorId, deviceId } of DevicesIds){
            legacyDevice = findByIds(vendorId, deviceId);
            if(legacyDevice) break;
        }
        if(!legacyDevice) return false;

        if(['darwin', 'linux'].includes(process.platform)){
            await unmountAll(vendorId, deviceId);
        }

        (navigator.usb as WebUSBInterop).trackLegacyDevice(legacyDevice);
        legacyDevice.open();
        const iface = legacyDevice.interface(0);
        try{
            if(iface.isKernelDriverActive())
                iface.detachKernelDriver();
        }catch(ex){
            console.log("Couldn't detach the kernel driver. Expected on Windows.");
        }
        const webUsbDevice = await WebUSBDevice.createInstance(legacyDevice);
        this.usbDevice = webUsbDevice;
        await webUsbDevice.open();
        if(process.platform === 'linux') {
            // TODO: Check windows.
            // Resetting on MacOS reattaches the system driver.
            await webUsbDevice.reset();
        }
        this.deviceConnectedCallback?.(legacyDevice, webUsbDevice);
        this.fsDriver = new UMSCHiMDFilesystem(webUsbDevice);
        return true;
    }
}
