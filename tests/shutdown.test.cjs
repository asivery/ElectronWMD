const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShutdownCoordinator } = require('../dist/shutdown');
const { closeUSBDevice, closeLegacyUSBDevice } = require('../dist/usb-cleanup');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('exit drains an active write, rejects new work, and shares one cleanup', async () => {
    const write = deferred();
    const order = [];
    const coordinator = new ShutdownCoordinator();
    coordinator.add('device', async () => order.push('close'));
    const operation = coordinator.run('write', async () => { await write.promise; order.push('written'); });
    const first = coordinator.shutdown();
    assert.equal(first, coordinator.shutdown());
    await assert.rejects(coordinator.run('new-write', () => assert.fail('must not run')), /shutting down/);
    assert.deepEqual(order, []);
    write.resolve();
    await Promise.all([operation, first]);
    await coordinator.shutdown();
    assert.deepEqual(order, ['written', 'close']);
    assert.equal(coordinator.closed, true);
});

test('failed operation still drains and allows device cleanup', async () => {
    const coordinator = new ShutdownCoordinator();
    let closed = false;
    coordinator.add('device', async () => { closed = true; });
    const operation = coordinator.run('read', () => { throw new Error('device unplugged'); });
    const shutdown = coordinator.shutdown();
    await assert.rejects(operation, /unplugged/);
    await shutdown;
    assert.equal(closed, true);
});

test('cleanup failure keeps tasks blocked and retries only unfinished steps', async () => {
    const coordinator = new ShutdownCoordinator();
    const calls = [];
    let fail = true;
    coordinator.add('session', async () => calls.push('session'));
    coordinator.add('usb', async () => { calls.push('usb'); if (fail) throw new Error('busy'); });
    await assert.rejects(coordinator.shutdown(), /busy/);
    assert.equal(coordinator.closed, false);
    await assert.rejects(coordinator.run('write', () => {}));
    fail = false;
    await coordinator.shutdown();
    assert.deepEqual(calls, ['session', 'usb', 'usb']);
});

test('slow writes show waiting status without forcing exit', async () => {
    const write = deferred();
    const waiting = deferred();
    let closed = false;
    const coordinator = new ShutdownCoordinator(() => {}, waiting.resolve, 5);
    coordinator.add('usb', async () => { closed = true; });
    coordinator.run('write', () => write.promise);
    const shutdown = coordinator.shutdown();
    await waiting.promise;
    assert.equal(closed, false);
    write.resolve();
    await shutdown;
    assert.equal(closed, true);
});

test('reset failure cannot skip close, and already closed devices are no-ops', async () => {
    const stages = [];
    const device = { opened: true, reset: async () => { throw new Error('reset failed'); },
        close: async () => { stages.push('close'); device.opened = false; } };
    await closeUSBDevice(device, stage => stages.push(stage), true);
    await closeUSBDevice(device, stage => stages.push(stage), true);
    assert.deepEqual(stages, ['usb-reset-failed', 'close']);
});

test('failed close propagates and can be retried', async () => {
    let fail = true;
    const device = { opened: true, reset: async () => {}, close: async () => {
        if (fail) throw new Error('pending request'); device.opened = false;
    }};
    await assert.rejects(closeUSBDevice(device, () => {}), /pending request/);
    assert.equal(device.opened, true);
    fail = false;
    await closeUSBDevice(device, () => {});
    assert.equal(device.opened, false);
});

test('polling is drained before native close, including detached interfaces', async () => {
    const stages = [];
    const device = { interfaces: [{ release(stop, cb) {
        assert.equal(stop, true);
        setImmediate(() => { stages.push('poll-ended'); cb(new Error('LIBUSB_ERROR_NO_DEVICE')); });
    }}], close() { stages.push('close'); this.interfaces = undefined; } };
    await closeLegacyUSBDevice(device, stage => stages.push(stage));
    await closeLegacyUSBDevice(device, () => assert.fail());
    assert.deepEqual(stages, ['poll-ended', 'usb-release-failed', 'close']);
});

test('a close that silently leaves the handle open is a failure', async () => {
    await assert.rejects(closeUSBDevice({ opened: true, close: async () => {}, reset: async () => {} }, () => {}), /remained open/);
});
