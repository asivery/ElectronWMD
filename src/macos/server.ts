import fs from 'fs';
import { EWMDHiMD } from '../wmd/translations';
import { createServer } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';
import { getSocketName } from './server-bootstrap';
import { WebUSB } from 'usb';
import { DevicesIds as HiMDDevicesIds } from 'himd-js';

const socketName = getSocketName();
function closeAll(){
    fs.unlinkSync(socketName);
    process.exit();
}
function main(){
    const webusb = new WebUSB({
        allowedDevices: HiMDDevicesIds.map((n) => ({ vendorId: n.vendorId, productId: n.deviceId })),
        deviceTimeout: 10000000,
    });

    Object.defineProperty(global, 'navigator', {
        writable: false,
        value: { usb: webusb },
    });
    Object.defineProperty(global, 'window', {
        writable: false,
        value: global,
    });

    try{
        fs.unlinkSync(socketName);
    }catch(e){}

    const server = createServer();
    server.listen(socketName);
    fs.chmodSync(socketName, '777');
    server.on("close", closeAll);
    server.on('connection', (socket) => {
        console.log("Connection established.");
        socket.on('close', closeAll);
        const packerStream = new PackrStream();
        const unpackerStream = new UnpackrStream();

        const himdDevice = new EWMDHiMD({ debug: true });

        socket.pipe(unpackerStream);
        packerStream.pipe(socket);

        function sendCallback(callbackFunctionName: string, ...args: any[]){
            packerStream.write({
                type: 'callback',
                name: callbackFunctionName,
                value: args,
            })
        }

        unpackerStream.on('data', async ({ name, allArgs }: { name: string, allArgs: any[] }) => {
            console.log(`Call to ${name}`);
            for (let i = 0; i < allArgs.length; i++) {
                if (allArgs[i]?.interprocessType === 'function') {
                    allArgs[i] = async (...args: any[]) =>
                        {
                            sendCallback(`${name}_callback${i}`, ...args);
                        }
                }
            }
            let res;
            try {
                res = [await (himdDevice as any)[name](...allArgs), null];
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
    });
}

main()