import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { WebUSB } from 'usb';
import { DevicesIds } from 'netmd-js';
import path from 'path';
import { NetMDUSBService } from './wmd/netmd';

const getOfRenderer = (...p: string[]) => path.join(__dirname, "..", "renderer", ...p);

async function createWindow() {
    const window = new BrowserWindow({
        width: 1280,
        height: 900,
        icon: path.join(__dirname, "..", "res", "icon.png"),
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });
    await integrate(window);
    window.setMenuBarVisibility(false);
    await window.loadURL("file://" + getOfRenderer('index.html')); //Can't use the `sandbox://` protocol - index.html would (incorrectly) redirect to https
    window.setTitle("Electron WMD");
}

function traverseObject(window: BrowserWindow, objectFactory: () => any, nameTranslator: (name: string) => string = e => e){
    const defined = new Set<string>();
    let currentObj = objectFactory();
    do{
        Object.getOwnPropertyNames(currentObj)
            .filter(n => typeof currentObj[n] == "function" && !(n in defined))
            .forEach((n, i) => {
                const translatedName = nameTranslator(n);
                defined.add(translatedName);
                console.log(`[INTEGRATE]: Registering handler #${i}(${translatedName})`);
                ipcMain.handle(translatedName, async function(_, ...allArgs: any[]){
                    for(let i = 0; i<allArgs.length; i++){
                        if(allArgs[i]?.interprocessType === "function"){
                            allArgs[i] = async (...args: any[]) => window.webContents.send("_callback", `${translatedName}_callback${i}`, ...args);
                        }
                    }
                    try{
                        return [ await (objectFactory()[n](...allArgs)), null ];
                    }catch(err){
                        return [ null, err ];
                    }
                })
            });
    }while((currentObj = Object.getPrototypeOf(currentObj)));
    return defined;
}

async function integrate(window: BrowserWindow){
    const webusb = new WebUSB({
        allowedDevices: DevicesIds.map(n => ({ vendorId: n.vendorId, productId: n.deviceId })),
        deviceTimeout: 10000000,
    });
    Object.defineProperty(global, "navigator", {
        writable: false,
        value: { usb: webusb }
    });
    webusb.addEventListener("disconnect", () => window.reload());
    const service = new NetMDUSBService({debug: true});
    
    let currentObj = service as any;
    console.log(currentObj);

    const defList: string[] = [];
    traverseObject(window, () => currentObj).forEach(n => defList.push(n));

    ipcMain.handle("_definedParameters", () => defList);
    
    let alreadySwitched = false;
    let factoryIface: any = null;
    let factoryDefList: string[] = [];

    ipcMain.handle("_switchToFactory", async () => {
        factoryIface = await service.factory();
        if(alreadySwitched) return factoryDefList;
        alreadySwitched = true;

        traverseObject(window, () => factoryIface, e => `_factory__${e}`).forEach(e => factoryDefList.push(e));
        return factoryDefList;
    })
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('sandbox', (rq, callback) =>{
        const filePath = path.normalize(rq.url.substring('sandbox://'.length));
        if(path.isAbsolute(filePath) || filePath.includes("..")){
            app.quit();
        }
        const tgt = decodeURI(getOfRenderer(filePath));
        console.log(`[SANDBOX]: Requested ${tgt}`);
        callback(tgt);
    });
    createWindow();
});
