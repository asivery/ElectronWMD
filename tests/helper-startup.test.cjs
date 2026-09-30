const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const Module = require('node:module');
const { Connection } = require('../dist/macos/server-bootstrap');
const { DeviceHelperSession } = require('../dist/macos/device-session');
const { getSocketPath } = require('../dist/macos/socket-path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function launcher() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null)); };
    let invocation;
    const filename = path.resolve('dist/macos/server-bootstrap.js');
    const m = new Module(filename);
    m.filename = filename;
    const realRequire = Module.createRequire(filename);
    m.require = name => name === 'child_process' ? {
        spawn: (...args) => { invocation = args; return child; },
    } : realRequire(name);
    m._compile(fs.readFileSync(filename, 'utf8'), filename);
    return { child, start: m.exports.startOutsideElectron, invocation: () => invocation };
}

test('launcher reports success, authorization cancellation, launch errors and abort without Terminal', async () => {
    for (const mode of ['success', 'cancel', 'failure', 'spawn-error', 'abort']) {
        const f = launcher();
        const controller = new AbortController();
        const request = f.start('/test/electron', '/test/app', '/test/data', undefined, controller.signal);
        const [exe, args, options] = f.invocation();
        assert.equal(exe, '/usr/bin/osascript');
        assert.match(args[1], /with administrator privileges/);
        assert.doesNotMatch(args[1], /tell application|sudo|password|\/usr\/bin\/nohup/);
        assert.equal(options.stdio[0], 'ignore');
        if (mode === 'success') {
            f.child.stdout.write('/tmp/private/helper.log\n');
            f.child.emit('close', 0);
            assert.equal(await request, '/tmp/private/helper.log');
        } else {
            const rejected = assert.rejects(request, mode === 'cancel' || mode === 'abort' ? /cancelled/i : /failed|denied/);
            if (mode === 'cancel') { f.child.stderr.write('execution error: User canceled. (-128)'); f.child.emit('close', 1); }
            if (mode === 'failure') { f.child.stderr.write('authorization failed'); f.child.emit('close', 1); }
            if (mode === 'spawn-error') f.child.emit('error', new Error('spawn denied'));
            if (mode === 'abort') { controller.abort(); assert.equal(f.child.killed, true); }
            await rejected;
        }
    }
    const f = launcher();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.start('/exe', '/app', '/data', undefined, controller.signal), /cancelled/);
    assert.equal(f.invocation(), undefined);
});

test('launch command preserves special paths and environment, detaches output and creates private logs', async () => {
    const directory = fs.mkdtempSync('/tmp/ewmd-quote-');
    const special = path.join(directory, '中文 空格\'"$`\\\n');
    const executable = path.join(special, 'node');
    const f = launcher();
    let logPath;
    try {
        fs.mkdirSync(path.join(special, 'dist/macos'), { recursive: true });
        fs.symlinkSync(process.execPath, executable);
        fs.writeFileSync(path.join(special, 'dist/macos/server.js'),
            'console.log(JSON.stringify({data:process.argv[2],dir:process.env.EWWORKDIR,uid:process.env.ORIGINAL_UID,gid:process.env.ORIGINAL_GID,node:process.env.ELECTRON_RUN_AS_NODE}))');
        const request = f.start(executable, special, special, special);
        const script = f.invocation()[1][1];
        const command = JSON.parse(script.slice('do shell script '.length, script.indexOf(' with administrator privileges')));
        // Compile the actual AppleScript without running it or requesting privileges.
        if (process.platform === 'darwin') {
            execFileSync('/usr/bin/osacompile', ['-o', path.join(directory, 'launch.scpt'), '-e', script]);
            const literal = script.slice('do shell script '.length, script.indexOf(' with administrator privileges'));
            assert.equal(execFileSync('/usr/bin/osascript', ['-e', `return ${literal}`], { encoding: 'utf8' }), command + '\n');
        }
        logPath = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 5000 });
        f.child.stdout.write(logPath);
        f.child.emit('close', 0);
        assert.equal(await request, logPath);
        let content = '';
        for (let i = 0; i < 100; i++) {
            if (fs.existsSync(logPath)) content = fs.readFileSync(logPath, 'utf8');
            if (content.includes('\n')) break;
            await delay(20);
        }
        assert.deepEqual(JSON.parse(content), {
            data: special, dir: special, uid: String(process.getuid()), gid: String(process.getgid()), node: '1',
        });
        assert.equal(fs.statSync(path.dirname(logPath)).mode & 0o777, 0o700);
        assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
        assert.equal(fs.statSync(logPath).uid, process.getuid());
        assert.equal(fs.statSync(path.dirname(logPath)).uid, process.getuid());
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        if (logPath) fs.rmSync(path.dirname(logPath), { recursive: true, force: true });
    }
});

test('readiness retries missing sockets, times out, cancels, then allows retry without triggering reload', async () => {
    const directory = fs.mkdtempSync('/tmp/ewmd-ready-');
    const old = process.env.EWWORKDIR;
    process.env.EWWORKDIR = directory;
    const connection = new Connection();
    connection.deviceDisconnectedCallback = () => assert.fail('An unsuccessful startup must not reload WMD');
    const server = net.createServer();
    let peer;
    server.on('connection', socket => { peer = socket; });
    try {
        await assert.rejects(connection.awaitConnection(undefined, 120), /did not become ready/);
        assert.equal(connection.socket, null);
        const controller = new AbortController();
        const cancelled = assert.rejects(connection.awaitConnection(controller.signal, 5000), /cancelled/);
        controller.abort();
        await cancelled;
        const ready = connection.awaitConnection(undefined, 2000);
        await delay(150);
        server.listen(getSocketPath());
        await once(server, 'listening');
        await ready;
        assert.equal(connection.socket.destroyed, false);
    } finally {
        connection.deviceDisconnectedCallback = undefined;
        connection.socket?.destroy();
        peer?.destroy();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        if (old === undefined) delete process.env.EWWORKDIR; else process.env.EWWORKDIR = old;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('session merges overlapping connects, preserves RPC ordering and permits authorization retry', async () => {
    const events = [];
    let authorize;
    let fail = true;
    const connection = {
        socket: null,
        shutdown: async () => { events.push('shutdown'); connection.socket = null; },
        awaitConnection: async () => { events.push('ready'); connection.socket = {}; },
        callMethod: async (_, method) => { events.push(method); return method; },
    };
    const session = new DeviceHelperSession(connection, async () => {
        events.push('authorize');
        if (fail) throw new Error('cancelled');
        await new Promise(resolve => { authorize = resolve; });
        return '/tmp/log';
    }, () => events.push('focus'));
    await assert.rejects(session.call('himd', 'connect'), /cancelled/);
    await assert.rejects(session.call('himd', 'pair'), /cancelled/);
    fail = false;
    const first = session.call('himd', 'connect');
    assert.equal(first, session.call('himd', 'connect'));
    const read = session.call('himd', 'listContent');
    await delay(0);
    authorize();
    assert.deepEqual(await Promise.all([first, read]), ['connect', 'listContent']);
    assert.deepEqual(events, ['authorize', 'authorize', 'ready', 'focus', 'connect', 'listContent']);
    await session.shutdown();
    assert.equal(events.at(-1), 'shutdown');
});

test('shutdown aborts authorization before waiting on the RPC mutex', async () => {
    let cleanup = false;
    const session = new DeviceHelperSession({
        socket: null, shutdown: async () => { cleanup = true; },
    }, signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')))));
    const request = assert.rejects(session.call('himd', 'connect'), /cancelled/);
    await delay(0);
    await session.shutdown();
    await request;
    assert.equal(cleanup, true);
});

test('shutdown still drains queued device writes before closing the helper', async () => {
    const events = [];
    let finishWrite;
    const session = new DeviceHelperSession({
        socket: {},
        callMethod: async (_, method) => {
            events.push(method);
            if (method === 'write') await new Promise(resolve => { finishWrite = resolve; });
        },
        shutdown: async () => { events.push('shutdown'); },
    });
    const write = session.call('himd', 'write');
    const flush = session.call('himd', 'flush');
    await delay(0);
    const stopping = session.shutdown();
    assert.deepEqual(events, ['write']);
    finishWrite();
    await Promise.all([write, flush, stopping]);
    assert.deepEqual(events, ['write', 'flush', 'shutdown']);
});

test('readiness failure includes the readable startup log and survives the renderer pair fallback', async () => {
    const directory = fs.mkdtempSync('/tmp/ewmd-startup-error-');
    const logPath = path.join(directory, 'helper.log');
    try {
        fs.writeFileSync(logPath, 'x'.repeat(10000) + '\nCannot load helper dependency\n');
        const session = new DeviceHelperSession({
            socket: null,
            awaitConnection: async () => { throw new Error('did not become ready'); },
        }, async () => logPath);
        await assert.rejects(session.call('himd', 'connect'), error => {
            assert.match(error.message, /did not become ready/);
            assert.match(error.message, /Cannot load helper dependency/);
            assert.match(error.message, /Helper log:/);
            assert.ok(error.message.length < 9000);
            return true;
        });
        await assert.rejects(session.call('himd', 'pair'), /Cannot load helper dependency/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
