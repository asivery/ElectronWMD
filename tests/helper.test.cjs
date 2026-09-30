const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { PackrStream, UnpackrStream } = require('msgpackr');
const { Connection } = require('../dist/macos/server-bootstrap');
const { getSocketPath, getPidPath } = require('../dist/macos/socket-path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('helper reports closed handles before EOF, and exits cleanly on RPC, disconnect and SIGTERM', { timeout: 90000 }, async () => {
    const root = fs.mkdtempSync('/tmp/ewmd-helper-');
    const executable = process.env.EWMD_TEST_ELECTRON || process.execPath;
    try {
        for (const mode of ['rpc', 'connection-shutdown', 'disconnect', 'sigterm']) {
            const workDir = path.join(root, mode);
            fs.mkdirSync(workDir);
            const child = spawn(executable, [path.resolve('dist/macos/server.js'), workDir], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EWWORKDIR: workDir },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            child.stdout.on('data', b => output += b);
            child.stderr.on('data', b => output += b);
            const exited = once(child, 'exit');
            try {
                const socketPath = getSocketPath(workDir);
                for (let i = 0; !fs.existsSync(socketPath) && i < 100; i++) {
                    if (child.exitCode !== null || child.signalCode) throw new Error(output);
                    await sleep(50);
                }
                assert.ok(fs.existsSync(socketPath), output);
                if (mode === 'sigterm') child.kill('SIGTERM');
                else if (mode === 'connection-shutdown') {
                    const old = process.env.EWWORKDIR;
                    process.env.EWWORKDIR = workDir;
                    try {
                        const connection = new Connection();
                        connection.deviceDisconnectedCallback = () => assert.fail('Shutdown must not request a restart');
                        await connection.connect();
                        const stopping = connection.shutdown();
                        assert.equal(stopping, connection.shutdown());
                        await stopping;
                        assert.equal(connection.socket, null);
                    } finally {
                        if (old === undefined) delete process.env.EWWORKDIR; else process.env.EWWORKDIR = old;
                    }
                }
                else {
                    const socket = net.createConnection(socketPath);
                    await once(socket, 'connect');
                    if (mode === 'disconnect') socket.destroy();
                    else {
                        const incoming = new UnpackrStream();
                        const outgoing = new PackrStream();
                        socket.pipe(incoming); outgoing.pipe(socket);
                        const reply = once(incoming, 'data');
                        outgoing.write({ service: '__lifecycle', name: 'shutdown', allArgs: [] });
                        assert.deepEqual((await reply)[0], { type: 'return', name: 'shutdown', value: [null, null] });
                    }
                }
                const [code, signal] = await exited;
                assert.equal(signal, null, output);
                assert.equal(code, 0, output);
                assert.equal(fs.existsSync(socketPath), false);
                assert.equal(fs.existsSync(getPidPath(workDir)), false);
                assert.match(output, /shutdown-complete/);
            } finally {
                if (child.exitCode === null && !child.signalCode) { child.kill('SIGTERM'); await exited; }
            }
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Connection rejects an interrupted RPC instead of hanging forever', { timeout: 5000 }, async () => {
    const root = fs.mkdtempSync('/tmp/ewmd-transport-');
    const old = process.env.EWWORKDIR;
    process.env.EWWORKDIR = root;
    const server = net.createServer(socket => socket.on('data', () => socket.destroy()));
    server.listen(getSocketPath());
    await once(server, 'listening');
    try {
        const connection = new Connection();
        await connection.connect();
        await assert.rejects(connection.callMethod('himd', 'read'), /disconnected/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (old === undefined) delete process.env.EWWORKDIR; else process.env.EWWORKDIR = old;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
