import { app, BrowserWindow, ipcMain, Menu, protocol, dialog } from 'electron';
import { WebUSB } from 'usb';
import { DevicesIds } from 'netmd-js';
import path from 'path';
import { NetMDUSBService } from './wmd/netmd';
import fetch from 'node-fetch';
import Store from 'electron-store';

const getOfRenderer = (...p: string[]) => path.join(__dirname, '..', 'renderer', ...p);

async function createWindow() {
    const window = new BrowserWindow({
        width: 1280,
        height: 900,
        icon: path.join(__dirname, '..', 'res', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    await integrate(window);
    window.setMenuBarVisibility(false);
    await window.loadURL('file://' + getOfRenderer('index.html')); //Can't use the `sandbox://` protocol - index.html would (incorrectly) redirect to https
    window.setTitle('Electron WMD');

    const store = new Store();

    let downloadPath = store.get('downloadPath', null) as string | null;

    const setupMenu = () =>
        Menu.setApplicationMenu(
            Menu.buildFromTemplate(
                [{
                    label: 'File',
                    submenu: [
                        {
                            label: 'Reload',
                            click: () => window.reload(),
                        },
                        {
                            type: 'checkbox',
                            checked: downloadPath !== null,
                            label: downloadPath === null ? 'Set Default Download Directory' : `Current Download Directory: ${downloadPath}`,
                            click: () => {
                                if (downloadPath !== null) {
                                    store.set('downloadPath', null);
                                    downloadPath = null;
                                } else {
                                    const result = dialog.showOpenDialogSync(window, {
                                        title: 'Select Default Download Directory',
                                        properties: ['openDirectory'],
                                    });
                                    if (!result || result.length === 0) return;
                                    downloadPath = result[0];
                                    store.set('downloadPath', downloadPath);
                                }
                                setupMenu();
                            },
                        },
                        {
                            label: 'Exit',
                            click: () => window.close(),
                        },
                ]}, {
                    label: 'Edit',
                    submenu: [
                        {   label: "Undo", 
                            accelerator: "CmdOrCtrl+Z", 
                            role: "undo", 
                        },
                        {   label: "Redo",
                            accelerator: "Shift+CmdOrCtrl+Z",
                            role: "redo", 
                        },
                        {
                            type: "separator", 
                        },
                        {   label: "Cut",
                            accelerator: "CmdOrCtrl+X",
                            role: "cut",
                        },
                        {   label: "Copy",
                            accelerator: "CmdOrCtrl+C",
                            role: "copy",
                        },
                        {   label: "Paste",
                            accelerator: "CmdOrCtrl+V",
                            role: "paste",
                        },
                        {   label: "Select All",
                            accelerator: "CmdOrCtrl+A",
                            role: "selectAll",
                        },
                    ]},
            ])
        );

    setupMenu();
    window.setMenuBarVisibility(true);
    window.setAutoHideMenuBar(true);

    window.webContents.session.on('will-download', async (event, item, contents) => {
        if (downloadPath) {
            item.setSavePath(path.join(downloadPath, item.getFilename()));
        }
    });
}

function traverseObject(window: BrowserWindow, objectFactory: () => any, nameTranslator: (name: string) => string = (e) => e) {
    const defined = new Set<string>();
    let currentObj = objectFactory();
    do {
        Object.getOwnPropertyNames(currentObj)
            .filter((n) => typeof currentObj[n] == 'function' && !(n in defined))
            .forEach((n, i) => {
                const translatedName = nameTranslator(n);
                defined.add(translatedName);
                console.log(`[INTEGRATE]: Registering handler #${i}(${translatedName})`);
                ipcMain.handle(translatedName, async function (_, ...allArgs: any[]) {
                    for (let i = 0; i < allArgs.length; i++) {
                        if (allArgs[i]?.interprocessType === 'function') {
                            allArgs[i] = async (...args: any[]) =>
                                window.webContents.send('_callback', `${translatedName}_callback${i}`, ...args);
                        }
                    }
                    try {
                        return [await objectFactory()[n](...allArgs), null];
                    } catch (err) {
                        return [null, err];
                    }
                });
            });
    } while ((currentObj = Object.getPrototypeOf(currentObj)));
    return defined;
}

async function integrate(window: BrowserWindow) {
    const webusb = new WebUSB({
        allowedDevices: DevicesIds.map((n) => ({ vendorId: n.vendorId, productId: n.deviceId })),
        deviceTimeout: 10000000,
    });
    Object.defineProperty(global, 'navigator', {
        writable: false,
        value: { usb: webusb },
    });
    webusb.addEventListener('disconnect', () => window.reload());
    const service = new NetMDUSBService({ debug: true });

    let currentObj = service as any;
    console.log(currentObj);

    const defList: string[] = [];
    traverseObject(window, () => currentObj).forEach((n) => defList.push(n));

    ipcMain.handle('_definedParameters', () => defList);

    let alreadySwitched = false;
    let factoryIface: any = null;
    let factoryDefList: string[] = [];

    ipcMain.handle('_switchToFactory', async () => {
        factoryIface = await service.factory();
        if (alreadySwitched) return factoryDefList;
        alreadySwitched = true;

        traverseObject(
            window,
            () => factoryIface,
            (e) => `_factory__${e}`
        ).forEach((e) => factoryDefList.push(e));
        return factoryDefList;
    });

    ipcMain.handle('_unrestrictedFetch', async (_: any, url: string, parameters: any) => {
        return await (await fetch(url, parameters)).text();
    });
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('sandbox', (rq, callback) => {
        const filePath = path.normalize(rq.url.substring('sandbox://'.length));
        if (path.isAbsolute(filePath) || filePath.includes('..')) {
            app.quit();
        }
        const tgt = decodeURI(getOfRenderer(filePath));
        console.log(`[SANDBOX]: Requested ${tgt}`);
        callback(tgt);
    });
    createWindow();
});
