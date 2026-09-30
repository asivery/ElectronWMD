const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function fixture() {
    const directory = fs.mkdtempSync('/tmp/ewmd-exit-test-');
    const events = [];
    const app = new EventEmitter();
    app.getPath = () => directory;
    app.getName = () => 'test-fixture';
    app.setPath = () => {};
    app.relaunch = () => events.push('relaunch');
    app.quit = () => {
        const e = { prevented: false, preventDefault() { this.prevented = true; } };
        app.emit('before-quit', e);
        if (!e.prevented) events.push('quit');
    };
    const window = new EventEmitter();
    let destroyed = false;
    window.isDestroyed = () => destroyed;
    window.destroy = () => { destroyed = true; events.push('destroy'); };
    window.setTitle = () => {};
    window.setProgressBar = () => {};
    const filename = path.resolve('dist/app-shutdown.js');
    const m = new Module(filename);
    m.filename = filename;
    const originalRequire = Module.createRequire(filename);
    m.require = name => name === 'electron' ? {
        app, dialog: { showMessageBox: async () => { events.push('error-dialog'); return { response: 1 }; } },
    } : originalRequire(name);
    m._compile(fs.readFileSync(filename, 'utf8'), filename);
    m.exports.attachShutdownWindow(window);
    return { ...m.exports, app, window, events, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('window close and repeated quit cannot bypass cleanup; restart occurs afterwards once', async () => {
    const f = fixture();
    try {
        let finish;
        const active = f.lifecycle.run('write', () => new Promise(resolve => { finish = resolve; }));
        f.lifecycle.add('usb', async () => f.events.push('usb-closed'));
        let prevented = false;
        f.window.emit('close', { preventDefault() { prevented = true; } });
        f.app.quit();
        const request = f.requestShutdown('restart', true);
        await Promise.resolve();
        assert.equal(prevented, true);
        assert.deepEqual(f.events, []);
        finish();
        await Promise.all([active, request]);
        assert.deepEqual(f.events, ['usb-closed', 'relaunch', 'destroy', 'quit']);
    } finally { f.dispose(); }
});

test('failed cleanup retains window and restart intent until a successful retry', async () => {
    const f = fixture();
    try {
        let failing = true;
        f.lifecycle.add('usb', async () => { if (failing) throw new Error('busy'); });
        await f.requestShutdown('restart', true);
        assert.deepEqual(f.events, ['error-dialog']);
        assert.equal(f.window.isDestroyed(), false);
        failing = false;
        await f.requestShutdown('retry');
        assert.deepEqual(f.events, ['error-dialog', 'relaunch', 'destroy', 'quit']);
    } finally { f.dispose(); }
});
