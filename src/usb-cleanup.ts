import { ShutdownLog } from './shutdown';

export interface ClosableUSBDevice {
    opened: boolean;
    reset(): Promise<void>;
    close(): Promise<void>;
}

/** Reset is optional; a failed reset must never skip closing the handle. */
export async function closeUSBDevice(device: ClosableUSBDevice, log: ShutdownLog, reset = false): Promise<void> {
    if (!device.opened) return;
    if (reset) {
        try { await device.reset(); }
        catch (error) { log('usb-reset-failed', String(error)); }
    }
    await device.close();
    if (device.opened) throw new Error('USB handle remained open after close');
}

export interface LegacyUSBDevice {
    interfaces?: Array<{
        endpoints?: Array<{ direction?: string; pollActive?: boolean; stopPoll?: (callback: () => void) => void }>;
        release(closeEndpoints: boolean, callback: (error?: Error) => void): void;
    }>;
    close(): void;
}

export async function stopUSBPolling(device: LegacyUSBDevice): Promise<void> {
    for (const iface of device.interfaces || []) {
        for (const endpoint of iface.endpoints || []) {
            if (endpoint.pollActive && endpoint.stopPoll) {
                await new Promise<void>(resolve => endpoint.stopPoll!(resolve));
            }
        }
    }
}

/** Also handles partially initialized devices which never acquired a WebUSB wrapper. */
export async function closeLegacyUSBDevice(device: LegacyUSBDevice, log: ShutdownLog): Promise<void> {
    if (!device.interfaces) return;
    for (const iface of device.interfaces) {
        try {
            // node-usb waits for endpoint polling cancellation before releasing.
            await new Promise<void>((resolve, reject) => iface.release(true, error => error ? reject(error) : resolve()));
        } catch (error) {
            // Unclaimed/disconnected interfaces can fail release. Native close is still
            // needed, and node-usb itself refuses close when requests remain pending.
            log('usb-release-failed', String(error));
        }
    }
    device.close();
    if (device.interfaces) throw new Error('Native USB handle remained open after close');
}
