import { app, BrowserWindow, dialog } from 'electron';
import { ShutdownCoordinator } from './shutdown';
import { createShutdownLog } from './shutdown-log';
import path from 'path';
import fs from 'fs';

// Test builds have their own product name/userData; an explicit override is useful
// for repeatable smoke tests without touching the installed application's profile.
if (process.env.EWMD_USER_DATA) app.setPath('userData', path.resolve(process.env.EWMD_USER_DATA));
if (app.getName() === 'electronwmd-shutdown-test' && !process.env.EWWORKDIR) {
    // Keep the test app's privileged helper separate from the installed app.
    const workDir = path.join('/tmp', `ewmd-shutdown-test-${process.getuid?.() ?? 'user'}`);
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    process.env.EWWORKDIR = workDir;
}
export const shutdownLog = createShutdownLog(path.join(app.getPath('userData'), 'logs'), 'main');
let mainWindow: BrowserWindow | undefined;
let allowQuit = false;
let restarting = false;
let request: Promise<void> | undefined;

export const lifecycle = new ShutdownCoordinator(shutdownLog, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle('Electron WMD — Waiting for device operations to finish…');
        mainWindow.setProgressBar(2);
    }
});

export function attachShutdownWindow(window: BrowserWindow) {
    mainWindow = window;
    window.on('close', event => {
        if (allowQuit) return;
        event.preventDefault();
        void requestShutdown('window-close');
    });
}

export function requestShutdown(source: string, restart = false): Promise<void> {
    restarting = restarting || restart;
    if (request) return request;
    shutdownLog('exit-request', { source, restart: restarting, pending: lifecycle.pendingCount });
    request = lifecycle.shutdown().then(() => {
        allowQuit = true;
        if (restarting) app.relaunch();
        // All admitted operations and sessions are closed. Renderer beforeunload
        // must not launch fresh USB cleanup after native resources were released.
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        app.quit();
    }).catch(async error => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(-1);
            mainWindow.setTitle('Electron WMD — Device cleanup failed; retry exit');
        }
        shutdownLog('exit-blocked', String(error));
        const result = await dialog.showMessageBox({
            type: 'error',
            title: 'Unable to safely close the device',
            message: 'Electron WMD has stayed open because device cleanup failed.',
            detail: `${String(error)}\nNew device tasks are paused. Retry to finish cleanup and exit.`,
            buttons: ['Retry cleanup', 'Keep window open'],
            defaultId: 0,
            cancelId: 1,
        });
        request = undefined;
        if (result.response === 0) await requestShutdown('retry');
    });
    return request;
}

app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    void requestShutdown('before-quit');
});
