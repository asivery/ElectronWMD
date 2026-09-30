import { usb, WebUSB, WebUSBDevice } from "usb";
import { DevicesIds as  NetMDDevicesIds } from 'netmd-js';
import { DevicesIds as  HiMDDevicesIds } from 'himd-js';
import { DeviceIds as NWDevicesIds } from 'networkwm-js';
import { closeLegacyUSBDevice, closeUSBDevice, stopUSBPolling } from './usb-cleanup';
import { ShutdownLog } from './shutdown';

export class WebUSBInterop extends WebUSB {
    private openedLegacyDevices = new Set<usb.Device>();
    private log: ShutdownLog = () => {};

    trackLegacyDevice(device: usb.Device) {
        this.openedLegacyDevices.add(device);
    }

    async closeDevice(matches: (device: USBDevice) => boolean, reset = false) {
        for (const [legacy, device] of this.knownDevices) {
            if (matches(device)) {
                await stopUSBPolling(legacy);
                await closeUSBDevice(device, this.log, reset);
            }
        }
    }

    async shutdown(log: ShutdownLog = () => {}) {
        this.ondisconnect = null;
        this.onconnect = null;
        const devices = new Set([...this.openedLegacyDevices, ...this.knownDevices.keys()]);
        const errors: string[] = [];
        for (const device of devices) {
            try { await closeLegacyUSBDevice(device, log); }
            catch (error) { errors.push(String(error)); }
        }
        if (errors.length) throw new Error(errors.join('; '));
    }

    addKnownDevice(legacy: usb.Device, webusbInstance: WebUSBDevice){
        this.trackLegacyDevice(legacy);
        this.knownDevices.set(legacy, webusbInstance);
    }

    static create(log: ShutdownLog = () => {}){
        const webusb = new WebUSBInterop({
            allowedDevices: NetMDDevicesIds.concat(HiMDDevicesIds).concat(NWDevicesIds.map(e => ({ deviceId: e.productId, ...e}))).map((n) => ({ vendorId: n.vendorId, productId: n.deviceId })),
            deviceTimeout: 10000000,
        });
        webusb.log = log;
        return webusb;
    }
}
