import { app, BrowserWindow, ipcMain, protocol, dialog, FileFilter } from 'electron';
import { importKeys } from 'networkwm-js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EWMDHiMD, EWMDNetMD } from './wmd/translations';
import { Codec, NetMDFactoryService } from './wmd/original/services/interfaces/netmd';
import fetch from 'node-fetch';
import Store from 'electron-store';
import { Connection, startServer } from './macos/server-bootstrap';
import { spawn } from 'child_process';
import { NetworkWMService } from './wmd/networkwm-service';
import contextMenu from 'electron-context-menu';
import prompt from 'electron-prompt';
import { EKBROOTS } from 'networkwm-js/dist/encryption';
import { Mutex } from 'async-mutex';
import { WebUSBInterop } from './wusb-interop';

const getOfRenderer = (...p: string[]) => path.join(__dirname, '..', 'renderer', ...p);

async function ewmdOpenDialog(window: BrowserWindow, filters: FileFilter[], directory?: boolean){
    const res = await dialog.showOpenDialog(window, { filters, properties: [directory ? 'openDirectory' : 'openFile'] });
    if(res.canceled) return null;
    else return res.filePaths[0];
}

function reload(window: BrowserWindow){
    // AppImages do not restart correctly
    if (app.isPackaged && process.env.APPIMAGE) {
        dialog.showMessageBoxSync(window, { message: "This is an AppImage. Electron has a bug where AppImages cannot restart. Please restart the app manually" });
    }
    app.relaunch();
    app.exit();
}

app.commandLine.appendSwitch('ignore-certificate-errors');

export interface Setting {
    name: string;
    family: string;
    type: 'boolean' | 'string' | 'number' | 'action' | 'hostFilePath' | 'hostDirPath';
    state: boolean | string | number;
}

export interface SettingFunction extends Setting {
    handleChange(newValue: Setting['state']): Promise<void>;
}

function setupSettings(window: BrowserWindow) {
    const store = new Store();

    const _settings: (SettingFunction | null)[] = [
        {
            family: 'Functionality',
            name: 'Open Devtools',
            async handleChange(){
                window.webContents.openDevTools();
            },
            state: 0,
            type: 'action',
        },
        {
            family: 'Functionality',
            name: 'Use a Default Download Directory',
            async handleChange(newVal: boolean){
                if(newVal) {
                    // Enabled
                    if(!store.get('downloadPath', null)) { // Match both '' and null
                        // Ask the user for the path
                        const userProvided = await ewmdOpenDialog(window, [], true);
                        if(!userProvided) return; // If the user cancelled, do not write any changes
                        store.set('downloadPath', userProvided);
                    }
                }
                store.set('useDownloadPath', newVal);
            },
            state: store.get('useDownloadPath', false) as boolean,
            type: 'boolean',
        },
        store.get('useDownloadPath', false) ? {
            family: 'Functionality',
            name: 'Default Download Directory',
            async handleChange(newVal: string){
                if(!newVal && store.get('downloadPath', '')){
                    // If the user cancelled, but there's a path set already, do not do anything
                    return;
                }
                if(!newVal){
                    // The user cancelled, and there's nothing set (edge case)
                    // Disable the menu option
                    store.set('useDownloadPath', false);
                }
                store.set('downloadPath', newVal);
            },
            type: 'hostDirPath',
            state: store.get('downloadPath', '') as string,
        }: null,
        {
            family: 'Functionality',
            name: 'Import NetworkWM Keyring Data',
            type: 'action',
            state: 0,
            async handleChange() {
                const resp = await prompt({
                    title: 'Keyring Import',
                    label: 'Please enter the keyring string below',
                    inputAttrs: {
                        type: 'text',
                    }
                }, window);
                if(resp === null) return;
                let rawData;
                let backup = { ...EKBROOTS };
                Object.keys(EKBROOTS).forEach((e: any) => delete EKBROOTS[e]);
                try{
                    rawData = Uint8Array.from(atob(resp), e => e.charCodeAt(0));
                    importKeys(rawData);
                }catch(ex){
                    dialog.showMessageBoxSync(window, { message: 'Keyring import failed.' });
                    Object.keys(EKBROOTS).forEach((e: any) => EKBROOTS[e] = backup[e]); 
                    return;
                }
                fs.writeFileSync(path.join(app.getPath('userData'), 'EKBROOTS.DES'), rawData);
                reload(window);
            }
        }
    ];
    const settings = _settings.filter(e => e);

    ipcMain.removeHandler('setting_update');
    ipcMain.removeHandler('fetch_settings_list');

    ipcMain.handle("setting_update", async (_, name: string, newValue: Setting['state']) => {
        const setting = settings.find(e => e.name === name);
        if((setting as any).handleChange){
            await (setting as any).handleChange(newValue);
            setupSettings(window);
        }
    });

    ipcMain.handle("fetch_settings_list", () => {
        return settings.map(e => {
            let q = { ...e } as any;
            delete q['handleChange'];
            return q;
        });
    });
}

function setupEncoder() {
    function invoke(program: string, args: string[]): Promise<boolean> {
        return new Promise<boolean>(res => {
            const name = path.basename(program);
            const process = spawn(program, args);
            process.on('close', (e) => res(e === 0));
            process.stdout.on('data', e => console.log(`[${name} - STDOUT]: ${e.toString().trim()}`));
            process.stderr.on('data', e => console.log(`[${name} - STDERR]: ${e.toString().trim()}`));
        });
    }

    ipcMain.handle("invokeLocalEncoder", async (_, ffmpegPath: string, encoderPath: string, data: ArrayBuffer, sourceFilename: string, parameters: { format: Codec, enableReplayGain?: boolean }) => {
        // Pipeline:
        // inFile.ANY ==(ffmpeg)==> inFile.wav ==(encoder)==> outFile.wav
        let tempDir = '';
        if ( os.platform() === 'darwin') {
            const homeDir = app.getPath('home');
            tempDir = path.join(homeDir, 'Library','Caches','ElectronWMD');
        } else {
            tempDir = fs.mkdtempSync('atracenc');
        }

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        const inFilePath = path.join(tempDir, sourceFilename);
        fs.writeFileSync(inFilePath, new Uint8Array(data));
        const intermediateFilePath = path.join(tempDir, "intermediate.wav");
        const ffmpegArgs = ['-i', inFilePath];
        if(parameters.enableReplayGain){
            ffmpegArgs.push('-af', 'volume=replaygain=track');
        }
        ffmpegArgs.push('-ac', '2', '-ar', '44100', '-f', 'wav', intermediateFilePath);
        console.log(`Executing ffmpeg. ARGS: ${ffmpegArgs}`);
        await invoke(ffmpegPath, ffmpegArgs);

        const outFilePath = path.join(tempDir, "output.wav");
        const bitrateString = (parameters.format.bitrate! + '');
        const allArgs = ['-e', '-br', bitrateString, intermediateFilePath, outFilePath];
        console.log(`Executing encoder EXE: ${encoderPath}. ARGS: ${allArgs}`);
        await invoke(encoderPath, allArgs);
        const rawData = new Uint8Array(fs.readFileSync(outFilePath)).buffer;
        fs.unlinkSync(outFilePath);
        fs.unlinkSync(inFilePath);
        fs.unlinkSync(intermediateFilePath);
        fs.rmdirSync(tempDir);
        return rawData;
    });
}

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

    console.log(app.getPath('exe'))

    await integrate(window);
    window.setMenuBarVisibility(false);
    await window.loadURL('file://' + getOfRenderer('index.html')); //Can't use the `sandbox://` protocol - index.html would (incorrectly) redirect to https
    window.setTitle('Electron WMD');

    const store = new Store();

    window.setMenuBarVisibility(false);

    window.webContents.session.on('will-download', async (event, item, contents) => {
        let downloadPath = store.get('downloadPath', '') as string;
        let useDownloadPath = store.get('useDownloadPath', false) as boolean;

        if (downloadPath && useDownloadPath) {
            const baseFilename = item.getFilename();
            let filename = path.join(downloadPath, baseFilename);
            const { name, ext } = path.parse(baseFilename);
            let i = 1;
            while(fs.existsSync(filename)){
                filename = path.join(downloadPath, `${name} (${i++})${ext}`);
            }
            item.setSavePath(filename);
        }
    });
}

function getDefinedFunctions(currentObj: any){
    const defined = new Set<string>();
    do{
        Object.getOwnPropertyNames(currentObj)
        .filter((n) => typeof currentObj[n] == 'function' && !(n in defined))
        .forEach(defined.add.bind(defined));
    } while ((currentObj = Object.getPrototypeOf(currentObj)));
    return defined;
}

function traverseObject(window: BrowserWindow, objectFactory: () => any, namespace: string) {
    let currentObj = objectFactory();
    const defined = getDefinedFunctions(currentObj);
    defined.forEach((n) => {
        const translatedName = namespace + n;
        console.log(`[INTEGRATE]: Registering handler ${translatedName}`);
        ipcMain.handle(translatedName, async function (_, ...allArgs: any[]) {
            for (let i = 0; i < allArgs.length; i++) {
                if (allArgs[i]?.interprocessType === 'function') {
                    allArgs[i] = async (...args: any[]) =>
                        {
                            window.webContents.send('_callback', `${translatedName}_callback${i}`, ...args);
                        }
                }
            }
            try {
                return [await objectFactory()[n](...allArgs), null];
            } catch (err) {
                console.log("Node Error: ");
                console.log(err);
                return [null, err];
            }
        });
    });
    return Array.from(defined).map(e => namespace + e);
}

async function integrate(window: BrowserWindow) {
    const webusb = WebUSBInterop.create();

    Object.defineProperty(global, 'navigator', {
        writable: false,
        value: { usb: webusb },
    });
    Object.defineProperty(global, 'window', {
        writable: false,
        value: global,
    });
    Object.defineProperty(global, 'alert', {
        writable: false,
        value: (text: string) => dialog.showMessageBoxSync(window, { message: text }),
    });

    const service = new EWMDNetMD({ debug: true });

    let currentObj = service as any;
    console.log(currentObj);

    const defList = traverseObject(window, () => currentObj, "_netmd_");
    ipcMain.handle('_netmd__definedParameters', () => defList);

    let alreadySwitched = false;
    let factoryIface: any = null;
    let factoryDefList: string[] = [];

    ipcMain.handle('reload', reload.bind(null, window));

    ipcMain.handle('_switchToFactory', async () => {
        factoryIface = await service.factory();
        if (alreadySwitched) return factoryDefList;
        alreadySwitched = true;

        factoryDefList = traverseObject(
            window,
            () => factoryIface,
            "_factory__"
        );


        // exploitDownloadTrack uses nested objects with callbacks, and callbacks with return values.
        // The nomral ipc-copying code can't be used for that.
        let shouldAbortAtracDownload = false;
        let handleBadSectorResolve: ((arg: "reload" | "abort" | "skip" | "yieldanyway") => void) | null = null

        ipcMain.removeHandler('_factory__exploitDownloadTrack');
        ipcMain.handle('_factory__exploitDownloadTrack', async (_, ...allArgs: Parameters<NetMDFactoryService['exploitDownloadTrack']>) => {
            handleBadSectorResolve = null;
            shouldAbortAtracDownload = false;

            const enableHandleBadSector = allArgs[3].handleBadSector;
            const enableShouldCancelImmediately = allArgs[3].handleBadSector;

            allArgs[3] = {
                ...allArgs[3],
                handleBadSector: async (...args: any[]) => {
                    window.webContents.send('_atracdl_callback_handleBadSector', ...args);
                    return await new Promise<"reload" | "abort" | "skip" | "yieldanyway">(res => handleBadSectorResolve = res);
                },
                shouldCancelImmediately: () => shouldAbortAtracDownload,
            };
            if(!enableHandleBadSector) delete allArgs[3].handleBadSector;
            if(!enableShouldCancelImmediately) delete allArgs[3].shouldCancelImmediately;
            allArgs[2] = async (...args: any[]) =>
                window.webContents.send('_callback', `_factory__exploitDownloadTrack_callback2`, ...args);

            try{
                return [await factoryIface.exploitDownloadTrack(...allArgs), null];
            }catch (err) {
                console.log("Node Error: ");
                console.log(err);
                return [null, err];
            }
        });
        ipcMain.handle('_atracdl_cancel', () => shouldAbortAtracDownload = true);
        ipcMain.handle('_atracdl_callback_handleBadSector_return', (_, status: "reload" | "abort" | "skip" | "yieldanyway") => handleBadSectorResolve?.(status));

        return factoryDefList;
    });

    const himdService = new EWMDHiMD({ debug: true });

    let keyData: Uint8Array | undefined = undefined;
    try{
        keyData = new Uint8Array(fs.readFileSync(path.join(app.getPath('userData'), 'EKBROOTS.DES')));
    }catch(_){ console.log("Can't read roots") }
    const nwService = new NetworkWMService(keyData);

    if(process.platform !== 'darwin') {
        const himdDeflist = traverseObject(window, () => himdService, "_himd_");
        ipcMain.handle('_himd__definedParameters', () => himdDeflist);
        const nwDeflist = traverseObject(window, () => nwService, "_nwjs_");
        ipcMain.handle('_nwjs__definedParameters', () => nwDeflist);    
    } else {
        const connection = new Connection();
        connection.deviceDisconnectedCallback = () => reload(window);
        const connectionMutex = new Mutex();

        connection.callbackHandler = (service, name: string, ...args: any[]) => window.webContents.send("_callback", (service === 'himd' ? '_himd_' : '_nwjs_') + name, ...args);
        const himdDefinedMethods = getDefinedFunctions(himdService);
        ipcMain.handle('_himd__definedParameters', () => [...himdDefinedMethods].map(e => '_himd_' + e));
        for(let methodName of himdDefinedMethods){
            ipcMain.handle(`_himd_${methodName}`, async (_, ...allArgs: any[]) => {
                console.log(`Execute: ${methodName}`);
                if(methodName === 'connect'){
                    let connectionEstablished = false;
                    if(connection.socket) {
                        connection.disconnect();
                    }
                    try{
                        startServer().then(() => {
                            if(!connectionEstablished) {
                                connection.terminateAwaitConnection();
                            }
                        });
                    }catch(ex) {
                        return [null, ex];
                    }
                    const error = await connection.awaitConnection();
                    connectionEstablished = true;
                    if(error) {
                        return [null, error];
                    }
                }
                if(!connection.socket) {
                    return [null, new Error("Server not ready!")];
                }

                const release = await connectionMutex.acquire();
                try {
                    return [await connection.callMethod('himd', methodName, ...allArgs), null];
                } catch (err) {
                    console.log("External HIMD Error: ");
                    console.log(err);
                    return [null, err];
                } finally {
                    release();
                }
            });
        }

        const nwjsDefinedMethods = getDefinedFunctions(himdService);
        ipcMain.handle('_nwjs__definedParameters', () => [...nwjsDefinedMethods].map(e => '_nwjs_' + e));
        for(let methodName of nwjsDefinedMethods){
            ipcMain.handle(`_nwjs_${methodName}`, async (_, ...allArgs: any[]) => {
                console.log(`Execute: ${methodName}`);
                if(methodName === 'connect'){
                    let connectionEstablished = false;
                    if(connection.socket) {
                        connection.disconnect();
                    }
                    try{
                        startServer().then(() => {
                            if(!connectionEstablished) {
                                connection.terminateAwaitConnection();
                            }
                        });
                    }catch(ex) {
                        return [null, ex];
                    }
                    const error = await connection.awaitConnection();
                    connectionEstablished = true;
                    if(error) {
                        return [null, error];
                    }
                }
                if(!connection.socket) {
                    return [null, new Error("Server not ready!")];
                }

                const release = await connectionMutex.acquire();
                try {
                    return [await connection.callMethod('nwjs', methodName, ...allArgs), null];
                } catch (err) {
                    console.log("External NWJS Error: ");
                    console.log(err);
                    return [null, err];
                } finally {
                    release();
                }
            });
        }
    }

    ipcMain.handle('_unrestrictedFetch', async (_: any, url: string, parameters: any) => {
        return await (await fetch(url, parameters)).text();
    });

    ipcMain.handle('_signHiMDDisc', () => (global as any).signHiMDDisc());

    ipcMain.handle('_debug_himdPullFile', async (e, a: string, b: string) => {
        console.log(`Pulling HiMD file ${a} to local ${b}`);
        const handle = await himdService.fsDriver!.fatfs!.open(a, false);
        if(!handle){
            console.log("No file!");
        }
        fs.writeFileSync(b, await handle.readAll());
        await handle.close();
    });
    ipcMain.handle('_debug_himdList', async (e, a: string) => {
        console.log(`Listing HiMD dir ${a}`);
        const list = await himdService.fsDriver!.fatfs!.listDir(a);
        if(!list){
            console.log("No such dir!");
        }
        console.log(list.join(', '));
    });

    ipcMain.handle("openFileHostDialog", async (_, filters: { name: string, extensions: string[] }[], directory?: boolean): Promise<string | null> => {
        return ewmdOpenDialog(window, filters, directory);     
    });

    setupSettings(window);
    setupEncoder();

    // On a USB disconnect event, enumerate services, check if any was connected
    const addKnownDeviceCB = webusb.addKnownDevice.bind(webusb);
    nwService.deviceConnectedCallback = addKnownDeviceCB;
    himdService.deviceConnectedCallback = addKnownDeviceCB;
    webusb.ondisconnect = event => {
        if([service, himdService, nwService].some(e => e.isDeviceConnected(event.device))) {
            reload(window);
        }
    }
}

contextMenu({
    showInspectElement: false,
});

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
