import fs from 'fs';
import { EWMDHiMD } from '../wmd/translations';
import { createServer } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';
import path from 'path';
import { NetworkWMService } from '../wmd/networkwm-service';
import { WebUSBInterop } from '../wusb-interop';
import { getPidPath, getSocketDir, getSocketPath } from './socket-path';
import { ShutdownCoordinator } from '../shutdown';
import { createShutdownLog } from '../shutdown-log';

const socketName = getSocketPath();
const pidFile = getPidPath();
const workDir = getSocketDir();
const canFail = (func: () => void) => {
    try{ func() } catch(_){}
}

function main() {
    console.log("ElectronWMD's MacOS SCSI intermediate server by asivery");
    console.log("Starting up...");
    console.log(`Base dir: ${workDir}`);
    console.log(`Socket path: ${socketName}`);
    console.log(`PID file: ${pidFile}`);
    if(fs.existsSync(pidFile)) {
        const oldPid = parseInt(fs.readFileSync(pidFile).toString());
        try { process.kill(oldPid, 0); throw new Error(`Device helper ${oldPid} is already running`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        fs.unlinkSync(pidFile);
    }
    
    fs.writeFileSync(pidFile, `${process.pid}`);
    const log = createShutdownLog(path.join(workDir, `ewmd-${process.env.ORIGINAL_UID || process.getuid()}`), 'helper');
    const webusb = WebUSBInterop.create(log);

    Object.defineProperty(global, 'navigator', {
        writable: false,
        value: { usb: webusb },
    });
    Object.defineProperty(global, 'window', {
        writable: false,
        value: global,
    });

    canFail(() => fs.unlinkSync(socketName));

    const lifecycle = new ShutdownCoordinator(log);
    const himdDevice = new EWMDHiMD({ debug: true });
    let keyData: Uint8Array | undefined;
    try { keyData = new Uint8Array(fs.readFileSync(path.join(process.argv[2], 'EKBROOTS.DES'))); }
    catch (_) { console.log("Can't read roots"); }
    const nwDevice = new NetworkWMService(keyData);
    lifecycle.add('himd', () => himdDevice.shutdown());
    lifecycle.add('networkwm', () => nwDevice.shutdown());
    lifecycle.add('remaining-usb-handles', () => webusb.shutdown(log));
    const server = createServer();
    let exiting = false;
    let clientWaitTimer: ReturnType<typeof setTimeout>;
    let failureKeepAlive: ReturnType<typeof setInterval> | undefined;
    const removeSocketFiles = () => {
        canFail(() => fs.unlinkSync(socketName));
        canFail(() => fs.unlinkSync(pidFile));
    };
    async function closeAll() {
        if (exiting) return;
        clearTimeout(clientWaitTimer);
        try {
            await lifecycle.shutdown();
            exiting = true;
            removeSocketFiles();
            // All USB handles have been closed before Node finalizers run.
            process.exit(0);
        } catch (error) {
            log('exit-blocked', String(error));
            if (!failureKeepAlive) failureKeepAlive = setInterval(() => {}, 1000);
        }
    }
    process.on('SIGTERM', () => { void closeAll(); });
    process.on('SIGINT', () => { void closeAll(); });
    // Authorization can finish after WMD has quit. Never leave an unused root
    // helper behind; still use the regular cleanup path, including failed-flush protection.
    clientWaitTimer = setTimeout(() => {
        log('client-connection-timeout');
        void closeAll();
    }, 30000);
    server.on('error', (err) => {
        console.error('Server error:', err);
        closeAll();
    });
    server.listen(socketName, () => {
        console.log(`Server listening on socket: ${socketName}`);
        try {
            const originalUid = isFinite(process.env.ORIGINAL_UID as any) ? parseInt(process.env.ORIGINAL_UID) : null;
            const originalGid = isFinite(process.env.ORIGINAL_GID as any) ? parseInt(process.env.ORIGINAL_GID) : null;
            if (originalUid !== null && originalGid !== null) {
                try { fs.chownSync(socketName, originalUid, originalGid); } catch (_) {}
                try { fs.chmodSync(socketName, 0o600); } catch (_) {}
                console.log(`Socket ownership set to ${originalUid}:${originalGid ?? 0} and mode 0600`);
            } else {
                fs.chmodSync(socketName, 0o777);
                console.log('Socket permissions set to 0777 (fallback)');
            }
        } catch (err) {
            console.error('Failed setting socket ownership/permissions:', err);
        }
    });

    server.on('connection', (socket) => {
        clearTimeout(clientWaitTimer);
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
            if (service === '__lifecycle' && name === 'shutdown') {
                try {
                    await lifecycle.shutdown();
                    exiting = true;
                    removeSocketFiles();
                    server.close();
                    packerStream.end({ type: 'return', name, value: [null, null] });
                    // Flush the acknowledgement before exiting the process.
                    socket.once('finish', () => process.exit(0));
                } catch (error) {
                    log('exit-blocked', String(error));
                    packerStream.write({ type: 'return', name, value: [null, String(error)] });
                }
                return;
            }
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
                if (!['nwjs', 'himd'].includes(service) || name === 'shutdown') throw new Error('Invalid device method');
                const serviceObject = service === 'nwjs' ? nwDevice : himdDevice;
                res = [await lifecycle.run(`${service}.${name}`, () => (serviceObject as any)[name](...allArgs)), null];
            } catch (err) {
                console.log("Node Error: ");
                console.log(err);
                res = [null, err];
            }

            if (socket.destroyed) return;
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
            if (lifecycle.stopping) return;
            if([nwDevice, himdDevice].some(e => e.isDeviceConnected(event.device))) {
                closeAll();
            }
        }
    });
}

main()
