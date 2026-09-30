const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const version = require('../electron-builder.test.json').electronVersion;
const executable = process.env.EWMD_TEST_ELECTRON || path.resolve(`build/electron-${version}/Electron.app/Contents/MacOS/Electron`);
const resultDir = path.resolve('build/verification');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.mkdirSync(resultDir, { recursive: true });

async function cycle(action, index) {
    const profile = fs.mkdtempSync('/tmp/ewmd-smoke-');
    const child = spawn(executable, [path.resolve('scripts/smoke-app.cjs')], {
        env: { ...process.env, EWMD_USER_DATA: profile, EWMD_SMOKE_ACTION: action },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', b => output += b);
    child.stderr.on('data', b => output += b);
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    let marker;
    try {
        const [code, signal] = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => resolve([code, signal]));
        });
        if (code !== 0 || signal || !output.includes('SMOKE_UI_RENDERED') || output.includes('SMOKE_RENDERER_EMPTY')) {
            throw new Error(`Smoke ${action} failed: code=${code} signal=${signal}\n${output}`);
        }
        if (action === 'restart') {
            for (let i = 0; i < 200; i++) {
                marker = JSON.parse(fs.readFileSync(path.join(profile, 'restart.json'), 'utf8'));
                if (marker.complete) break;
                await sleep(50);
            }
            if (!marker.complete || marker.firstPid === marker.secondPid) throw new Error('Relaunched process did not finish');
            let alive = true;
            for (let i = 0; i < 100 && alive; i++) {
                try { process.kill(marker.secondPid, 0); await sleep(50); }
                catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
            }
            if (alive) throw new Error('Relaunched process remained alive');
        }
        const log = fs.readFileSync(path.join(profile, 'logs/shutdown-main.log'), 'utf8');
        const completions = log.split('\n').filter(line => line.includes('"stage":"shutdown-complete"')).length;
        if (completions !== (action === 'restart' ? 2 : 1)) throw new Error(`Expected cleanup completion, saw ${completions}`);
        fs.writeFileSync(path.join(resultDir, `${index}-${action}-shutdown.jsonl`), log);
        return { action, code, signal, renderer: 'rendered', cleanupCompletions: completions, ...(marker || {}) };
    } finally {
        clearTimeout(timer);
        fs.writeFileSync(path.join(resultDir, `${index}-${action}.log`), output);
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

(async () => {
    const results = [];
    for (let i = 0; i < 20; i++) {
        results.push(await cycle(i % 2 ? 'quit' : 'close', i + 1));
        console.log(`Smoke ${i + 1}/20 passed`);
    }
    results.push(await cycle('restart', 21));
    fs.writeFileSync(path.join(resultDir, 'smoke-results.json'), JSON.stringify({ runtime: version, physicalDevice: false, results }, null, 2));
    console.log('20 UI launch/exit cycles and one real relaunch passed (no device connected).');
})().catch(error => { console.error(error); process.exitCode = 1; });
