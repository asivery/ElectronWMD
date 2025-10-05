import fs from 'fs';
import { EWMDHiMD } from '../wmd/translations';
import { createServer } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';
import path from 'path';
import { NetworkWMService } from '../wmd/networkwm-service';
import { WebUSBInterop } from '../wusb-interop';

const temp = process.env['EWWORKDIR'];

const socketName = path.join(temp, 'ewmd-intermediary.sock');
const pidFile = path.join(temp, 'ewmd-intermediary.pid');
const canFail = (func: () => void) => {
    try{ func() } catch(_){}
}

function closeAll(){
    canFail(() => fs.unlinkSync(socketName));
    canFail(() => fs.unlinkSync(pidFile));
    process.exit();
}
function main() {
    console.log("ElectronWMD's MacOS SCSI intermediate server by asivery");
    console.log("Starting up...");
    if(fs.existsSync(pidFile)) {
        const oldPid = parseInt(fs.readFileSync(pidFile).toString());
        canFail(() => process.kill(oldPid, 'SIGTERM'));
        canFail(() => fs.unlinkSync(pidFile));
    }
    
    fs.writeFileSync(pidFile, `${process.pid}`);
    const webusb = WebUSBInterop.create();

    Object.defineProperty(global, 'navigator', {
        writable: false,
        value: { usb: webusb },
    });
    Object.defineProperty(global, 'window', {
        writable: false,
        value: global,
    });

    canFail(() => fs.unlinkSync(socketName));

    const server = createServer();
    server.listen(socketName);
    fs.chmodSync(socketName, '777');
    server.on("close", closeAll);
    server.on('connection', (socket) => {
        console.log("Connection established.");
        socket.on('close', closeAll);
        const packerStream = new PackrStream({
            copyBuffers: true,
            structuredClone: true,
        });
        const unpackerStream = new UnpackrStream({
            copyBuffers: true,
            structuredClone: true,
        });

        const himdDevice = new EWMDHiMD({ debug: true });

        let keyData: Uint8Array | undefined = undefined;
        try{
            keyData = new Uint8Array(fs.readFileSync(path.join(process.argv[2], 'EKBROOTS.DES')));
        }catch(_){ console.log("Can't read roots") }
        const nwDevice = new NetworkWMService(keyData);

        socket.pipe(unpackerStream);
        packerStream.pipe(socket);

        function sendCallback(service: string, callbackFunctionName: string, ...args: any[]){
            packerStream.write({
                type: 'callback',
                name: callbackFunctionName,
                service,
                value: args,
            })
        }

        unpackerStream.on('data', async ({ service, name, allArgs }: { service: string, name: string, allArgs: any[] }) => {
            console.log(`Call to ${name}`);
            for (let i = 0; i < allArgs.length; i++) {
                if (allArgs[i]?.interprocessType === 'function') {
                    allArgs[i] = async (...args: any[]) =>
                        {
                            sendCallback(service, `${name}_callback${i}`, ...args);
                        }
                }
            }
            let res;
            try {
                const serviceObject = service === 'nwjs' ? nwDevice : himdDevice;
                res = [await (serviceObject as any)[name](...allArgs), null];
            } catch (err) {
                console.log("Node Error: ");
                console.log(err);
                res = [null, err];
            }

            packerStream.write({
                type: 'return',
                name,
                value: res,
            });
        })

        const addKnownDeviceCB = webusb.addKnownDevice.bind(webusb);
        nwDevice.deviceConnectedCallback = addKnownDeviceCB;
        himdDevice.deviceConnectedCallback = addKnownDeviceCB;
        webusb.ondisconnect = event => {
            if([nwDevice, himdDevice].some(e => e.isDeviceConnected(event.device))) {
                closeAll();
            }
        }
    });
}

main()
