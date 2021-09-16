import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { usb } from 'webusb';
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

async function integrate(window: BrowserWindow){
    Object.defineProperty(global, "navigator", {
        writable: false,
        value: { usb }
    });
    const service = new NetMDUSBService({debug: true});
    
    let currentObj = service as any;
    const defined = new Set<string>();
    do{
        Object.getOwnPropertyNames(currentObj)
            .filter(n => typeof currentObj[n] == "function" && !(n in defined))
            .forEach((n, i) => {
                defined.add(n);
                console.log(`[INTEGRATE]: Registering handler #${i}(${n})`);
                ipcMain.handle(n, async function(e, ...allArgs: any[]){
                    for(let i = 0; i<allArgs.length; i++){
                        if(allArgs[i]?.interprocessType === "function"){
                            allArgs[i] = async (...args: any[]) => window.webContents.send("_callback", `${n}_callback${i}`, ...args);
                        }
                    }
                    try{
                        return await (service as any)[n](...allArgs);
                    }catch(err){
                        window.reload();
                        return null;
                    }
                })
            });
    }while((currentObj = Object.getPrototypeOf(currentObj)));

    const defList: string[] = [];
    defined.forEach(n => defList.push(n));

    ipcMain.handle("_definedParameters", () => defList);
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('sandbox', (rq, callback) =>{
        const filePath = path.normalize(rq.url.substr('sandbox://'.length));
        if(path.isAbsolute(filePath) || filePath.includes("..")){
            app.quit();
        }
        const tgt = decodeURI(getOfRenderer(filePath));
        console.log(`[SANDBOX]: Requested ${tgt}`);
        callback(tgt);
    });
    createWindow();
});
