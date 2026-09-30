const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const executable = path.resolve(process.env.EWMD_PACKAGED_EXECUTABLE || 'build/shutdown-test/mac-arm64/ElectronWMD Shutdown Test.app/Contents/MacOS/ElectronWMD Shutdown Test');
const directory = path.resolve('build/verification');
const profile = fs.mkdtempSync('/tmp/ewmd-packaged-');
fs.mkdirSync(directory, { recursive: true });

(async () => {
    const child = spawn(executable, ['--inspect=127.0.0.1:0'], {
        env: { ...process.env, EWMD_USER_DATA: profile }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', b => output += b);
    child.stderr.on('data', b => output += b);
    const exited = once(child, 'exit');
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
    let socket;
    try {
        let match;
        for (let i = 0; i < 100; i++) {
            match = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/);
            if (match) break;
            if (child.exitCode !== null || child.signalCode) throw new Error(output);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(match, 'Main-process inspector did not start');
        // Electron replaces its bootstrap context while loading the entrypoint.
        // Attach only once the real application's renderer has started loading.
        for (let i = 0; i < 200 && !output.includes('[SANDBOX]'); i++) {
            if (child.exitCode !== null || child.signalCode) throw new Error(output);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        socket = new WebSocket(match[0]);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let next = 0;
        function evaluate(expression) {
            const id = ++next;
            return new Promise((resolve, reject) => {
                function listener(event) {
                    const response = JSON.parse(event.data);
                    if (response.id !== id) return;
                    socket.removeEventListener('message', listener);
                    if (response.error || response.result.exceptionDetails) reject(new Error(JSON.stringify(response)));
                    else resolve(response.result.result.value);
                }
                socket.addEventListener('message', listener);
                socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
            });
        }
        const snapshot = path.join(directory, 'packaged-ui.png');
        console.log('Inspector:', await evaluate("JSON.stringify({main:process.mainModule?.filename,ready:process.mainModule.require('electron').app.isReady(),windows:process.mainModule.require('electron').BrowserWindow.getAllWindows().length})"));
        const result = await evaluate(`globalThis.__ewmdSmoke = (async () => {
            const { app, BrowserWindow } = process.mainModule.require('electron');
            await app.whenReady();
            let window;
            for (let i = 0; i < 200; i++) {
                window = BrowserWindow.getAllWindows()[0];
                if (window && await window.webContents.executeJavaScript('document.querySelector("#root")?.childElementCount > 0').catch(() => false)) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            const text = await window.webContents.executeJavaScript('document.body.innerText');
            const rendered = await window.webContents.executeJavaScript('document.querySelector("#root")?.childElementCount > 0');
            const image = await window.webContents.capturePage();
            process.mainModule.require('fs').writeFileSync(${JSON.stringify(snapshot)}, image.toPNG());
            return { rendered, text: text.substring(0, 500), electron: process.versions.electron, node: process.versions.node, userData: app.getPath('userData'), name: app.getName(), helperDir: process.env.EWWORKDIR, arch: process.arch };
        })()`);
        assert.equal(result.rendered, true);
        assert.equal(result.userData, profile);
        assert.equal(result.arch, 'arm64');
        assert.match(result.helperDir, /ewmd-shutdown-test-/);
        if (process.env.EWMD_SMOKE_AUTHORIZATION === '1') {
            const authorization = await evaluate(`(async () => {
                const bootstrap = process.mainModule.require('./macos/server-bootstrap');
                const original = bootstrap.startServer;
                let launches = 0;
                bootstrap.startServer = async () => {
                    launches++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                    throw new Error('Administrator authorization was cancelled. Please connect again to retry.');
                };
                try {
                    const window = process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];
                    const messages = await window.webContents.executeJavaScript(\`(async () => {
                        const service = window.native.himdFullInterface;
                        const failure = promise => promise.then(() => 'unexpected success', error => error.message);
                        const errors = await Promise.all([failure(service.connect()), failure(service.connect())]);
                        errors.push(await failure(service.pair()));
                        errors.push(await failure(service.connect()));
                        return errors;
                    })()\`);
                    return { launches, messages, simulated: true };
                } finally { bootstrap.startServer = original; }
            })()`);
            assert.equal(authorization.launches, 2);
            assert.equal(authorization.messages.length, 4);
            for (const message of authorization.messages) assert.match(message, /authorization was cancelled/);
            result.authorization = authorization;
        }
        await evaluate("setTimeout(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].close(), 100); 'closing'");
        socket.close();
        const [code, signal] = await exited;
        assert.equal(code, 0, output);
        assert.equal(signal, null, output);
        const log = fs.readFileSync(path.join(profile, 'logs/shutdown-main.log'), 'utf8');
        assert.match(log, /shutdown-complete/);
        fs.writeFileSync(path.join(directory, 'packaged-shutdown.jsonl'), log);
        fs.writeFileSync(path.join(directory, 'packaged-result.json'), JSON.stringify({ ...result, code, signal, physicalDevice: false }, null, 2));
        console.log(JSON.stringify(result));
        console.log('Packaged arm64 app rendered and exited cleanly.');
    } finally {
        clearTimeout(timeout);
        socket?.close();
        if (child.exitCode === null && !child.signalCode) { child.kill('SIGTERM'); await exited; }
        fs.writeFileSync(path.join(directory, 'packaged.log'), output);
        fs.rmSync(profile, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
