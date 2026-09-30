// Run with the project's Electron binary and an isolated EWMD_USER_DATA.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
require('../dist/main');
app.whenReady().then(async () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Main window was not created');
    window.hide();
    window.webContents.on('console-message', (_, level, message) => {
        if (level >= 2) console.error('RENDERER:', message);
    });
    window.webContents.on('render-process-gone', (_, details) => {
        console.error('Renderer crashed', details);
        process.exitCode = 1;
    });
    await new Promise((resolve, reject) => {
        window.webContents.once('did-finish-load', resolve);
        window.webContents.once('did-fail-load', (_, code, reason) => reject(new Error(`${code}: ${reason}`)));
    });
    console.log('SMOKE_RENDERER_LOADED');
    const deadline = Date.now() + 10000;
    let rendered = false;
    while (Date.now() < deadline) {
        rendered = await window.webContents.executeJavaScript('document.querySelector("#root")?.childElementCount > 0');
        if (rendered) break;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!rendered) {
        console.error('SMOKE_RENDERER_EMPTY');
        process.exitCode = 1;
    } else console.log('SMOKE_UI_RENDERED');
    if (process.env.EWMD_SMOKE_ACTION === 'restart') {
        const marker = path.join(process.env.EWMD_USER_DATA, 'restart.json');
        if (!fs.existsSync(marker)) {
            fs.writeFileSync(marker, JSON.stringify({ firstPid: process.pid }));
            await require('../dist/app-shutdown').requestShutdown('smoke-restart', true);
        } else {
            const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
            app.once('will-quit', () => fs.writeFileSync(marker, JSON.stringify({ ...state, secondPid: process.pid, complete: true })));
            window.close();
        }
    } else if (process.env.EWMD_SMOKE_ACTION === 'quit') app.quit();
    else window.close();
});
