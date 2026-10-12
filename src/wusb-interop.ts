import { WebUSB } from "usb";
import { DevicesIds as  NetMDDevicesIds } from 'netmd-js';
import { DevicesIds as  HiMDDevicesIds } from 'himd-js';
import { DeviceIds as NWDevicesIds } from 'networkwm-js';
import { UsbDevice } from "usb/index";

export class WebUSBInterop extends WebUSB {
    addKnownDevice(key: string, device: UsbDevice){
        this.knownDevices.set(key, device);
    }

    static create(){
        const webusb = new WebUSBInterop({
            allowedDevices: NetMDDevicesIds.concat(HiMDDevicesIds).concat(NWDevicesIds.map(e => ({ deviceId: e.productId, ...e}))).map((n) => ({ vendorId: n.vendorId, productId: n.deviceId })),
            deviceTimeout: 10000000,
        });
        return webusb;
    }
}
