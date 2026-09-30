const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const { EWMDNetMD, EWMDHiMD } = require('../dist/wmd/translations');
const { NetworkWMService } = require('../dist/wmd/networkwm-service');
const { WebUSBInterop } = require('../dist/wusb-interop');

function deviceFixture() {
    const calls = [];
    const webusb = WebUSBInterop.create(stage => calls.push(stage));
    Object.defineProperty(global, 'navigator', { configurable: true, value: { usb: webusb } });
    const legacy = { interfaces: [], close() { calls.push('close'); this.interfaces = undefined; } };
    const device = {
        get opened() { return !!legacy.interfaces; },
        reset: async () => { calls.push('reset'); throw new Error('reset failed'); },
        close: async () => legacy.close(),
    };
    webusb.addKnownDevice(legacy, device);
    return { calls, webusb, legacy, device };
}

test('NetMD closes an upload session before releasing its USB device, despite reset failure', async () => {
    const f = deviceFixture();
    const service = new EWMDNetMD({ debug: false });
    service.netmdInterface = { netMd: { isDeviceConnected: device => device === f.device },
        release: async () => f.calls.push('release-session') };
    service.currentSession = { close: async () => f.calls.push('finish-upload') };
    await service.shutdown();
    await service.shutdown();
    await f.webusb.shutdown();
    assert.deepEqual(f.calls, ['finish-upload', 'release-session', 'reset', 'usb-reset-failed', 'close']);
});

test('HiMD keeps the native handle open after a failed flush and closes it after retry', async () => {
    const f = deviceFixture();
    const service = new EWMDHiMD({ debug: false });
    service.usbDevice = f.device;
    service.himd = { isDirty: () => true };
    let fail = true;
    service.flush = async () => { f.calls.push('flush'); if (fail) throw new Error('disc flush failed'); };
    await assert.rejects(service.shutdown(), /disc flush failed/);
    assert.equal(f.device.opened, true);
    assert.deepEqual(f.calls, ['flush']);
    fail = false;
    await service.shutdown();
    assert.deepEqual(f.calls, ['flush', 'flush', 'close']);
});

test('Network Walkman signs and flushes its session before closing', async () => {
    const f = deviceFixture();
    const service = new NetworkWMService();
    service.usbDevice = f.device;
    service.session = { finalizeSession: async () => f.calls.push('sign') };
    service.database = { flushUpdates: async () => f.calls.push('flush') };
    await service.shutdown();
    await service.shutdown();
    assert.deepEqual(f.calls, ['sign', 'flush', 'close']);
});

test('partially initialized legacy devices are closed even without a WebUSB wrapper', async () => {
    const f = deviceFixture();
    const partial = { interfaces: [], close() { f.calls.push('partial-close'); this.interfaces = undefined; } };
    f.webusb.trackLegacyDevice(partial);
    await f.webusb.shutdown();
    assert.equal(f.device.opened, false);
    assert.equal(partial.interfaces, undefined);
    assert.ok(f.calls.includes('partial-close'));
});

test('non-DRM Walkman uploads still flush before shutdown without a signing session', async () => {
    const f = deviceFixture();
    const service = new NetworkWMService();
    service.usbDevice = f.device;
    service.database = { deviceInfo: { disableDRM: true }, flushUpdates: async () => f.calls.push('flush') };
    await service.prepareUpload();
    assert.equal(service.session, null);
    await service.shutdown();
    assert.deepEqual(f.calls, ['flush', 'close']);
});
