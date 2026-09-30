// Exercise the shipped FFmpeg worker through the real Electron resource protocol.
// Uses generated audio and an isolated profile; never connects to a device.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync('/tmp/ewmd-conversion-');
process.env.EWMD_USER_DATA = profile;
process.env.EWWORKDIR = profile;
const appRoot = process.env.EWMD_CONVERSION_APP || path.resolve(__dirname, '..');
const timer = setTimeout(() => { console.error('Conversion timed out'); app.exit(1); }, 30000);
require(path.join(appRoot, 'dist/main'));

app.whenReady().then(async () => {
    const window = BrowserWindow.getAllWindows()[0];
    window.hide();
    await new Promise((resolve, reject) => {
        window.webContents.once('did-finish-load', resolve);
        window.webContents.once('did-fail-load', (_, code, reason) => reject(new Error(`${code}: ${reason}`)));
    });
    const bundle = fs.readFileSync(path.resolve(__dirname, '../webminidisc/node_modules/@ffmpeg/ffmpeg/dist/ffmpeg.min.js'), 'utf8');
    await window.webContents.executeJavaScript(bundle);
    const result = await window.webContents.executeJavaScript(`(async () => {
        const worker = FFmpeg.createWorker({
            workerPath: 'sandbox://worker.min.js',
            corePath: 'sandbox://ffmpeg-core.js',
        });
        try {
            await Promise.race([
                worker.load(),
                new Promise((_, reject) => worker.worker.addEventListener('error', e => reject(new Error(e.message)))),
            ]);
            // One second of 44.1 kHz stereo PCM, with an audible sine wave.
            const input = new Uint8Array(44100 * 4);
            const view = new DataView(input.buffer);
            for (let frame = 0; frame < 44100; frame++) {
                const sample = Math.round(8000 * Math.sin(2 * Math.PI * 440 * frame / 44100));
                view.setInt16(frame * 4, sample, true);
                view.setInt16(frame * 4 + 2, sample, true);
            }
            await worker.write('input.raw', input);
            await worker.run('-f s16le -ar 44100 -ac 2 -i input.raw input.wav');
            const sizes = [];
            // Verify repeated conversion jobs and exact output samples.
            for (let i = 0; i < 2; i++) {
                await worker.transcode('input.wav', 'out' + i + '.raw', '-ac 2 -ar 44100 -f s16be');
                const { data } = await worker.read('out' + i + '.raw');
                sizes.push(data.byteLength);
                for (let j = 0; j < input.length; j += 2) {
                    if (data[j] !== input[j + 1] || data[j + 1] !== input[j]) throw new Error('PCM samples differ');
                }
            }
            await worker.transcode('input.wav', 'out.mp3', '-ac 2 -ar 44100 -c:a libmp3lame -b:a 128k -f mp3');
            const mp3 = await worker.read('out.mp3');
            return { pcmBytes: sizes, mp3Bytes: mp3.data.byteLength, physicalDevice: false };
        } finally { worker.worker.terminate(); }
    })()`);
    assert.deepEqual(result.pcmBytes, [176400, 176400]);
    assert.ok(result.mp3Bytes > 1000);
    console.log('CONVERSION_PASS', JSON.stringify(result));
}).catch(error => {
    console.error('CONVERSION_FAIL', error);
    process.exitCode = 1;
}).finally(async () => {
    clearTimeout(timer);
    await require(path.join(appRoot, 'dist/app-shutdown')).requestShutdown('conversion-smoke');
});
app.on('will-quit', () => {
    fs.rmSync(profile, { recursive: true, force: true });
    if (process.exitCode) app.exit(process.exitCode);
});
