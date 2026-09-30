import { spawn } from 'child_process'
import { join as pathJoin } from 'path';
import { app } from 'electron';
import { Socket } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';
import fs from 'fs';
import { getSocketDir, getSocketPath } from './socket-path';

export function startServer(workDir?: string) {
    return startOutsideElectron(
        app.getPath('exe'),
        app.getAppPath(),
        app.getPath('userData'),
        workDir,
    );
}

export function startOutsideElectron(executablePath: string, applicationRoot: string, userDataPath: string, workDir?: string) {
    const socketName = getSocketPath(workDir);
    // The server checks its PID before removing stale files. Do not unlink a
    // live helper's socket here: it may still be finishing a write.

    let serverPath = pathJoin(applicationRoot, "dist", "macos", "server.js");
    if(!fs.existsSync(serverPath)) {
        serverPath = pathJoin(applicationRoot, "macos", "server.js");
    }
    let envs = `ELECTRON_RUN_AS_NODE=1`;
    envs += ` EWWORKDIR=${getSocketDir(workDir)}`;
    envs += ` ORIGINAL_UID=${process.getuid!() ?? ''}`;
    envs += ` ORIGINAL_GID=${process.getgid!() ?? ''}`;
    if(process.env.EWMD_HIMD_BYPASS_COHERENCY_CHECK) {
        envs += ` EWMD_HIMD_BYPASS_COHERENCY_CHECK=${process.env.EWMD_HIMD_BYPASS_COHERENCY_CHECK}`;
    }
    // Many people know part of the famous quote: "Think different...", but not many know the whole thing:
    // "Think different... Think of all the different ways we can take something simple and fuck it up"
    // Export critical env vars before invoking sudo; -E preserves them across the boundary
    const fullCommand = `${envs} "${executablePath}" "${serverPath}" "${userDataPath}" && exit`;
    const osa = `tell application "Terminal" \n activate \n do script "echo ${btoa(fullCommand)} | base64 -d | sudo -E zsh; exit"\nend tell`;
    
    return spawn('/usr/bin/osascript', ['-e', osa]);
}

export class Connection {
    socket: Socket;
    outStream = new PackrStream();
    
    awaitingReturnName: string | null = null;
    awaitingReturnResolve: ((obj: any) => void) | null = null;
    awaitingReturnReject: ((obj: any) => void) | null = null;

    callbackHandler: ((service: string, name: string, ...args: any[]) => void) | null = null;
    
    deviceDisconnectedCallback?: () => void;
    private shuttingDown = false;
    private shutdownRequest?: Promise<void>;

    connect(resetShutdown = true){
        return new Promise<void>((res, reject) => {
            if (resetShutdown) {
                this.shuttingDown = false;
                this.shutdownRequest = undefined;
            }
            this.socket = new Socket();
            this.socket.on('error', error => {
                this.rejectPending(error);
                reject(error);
            });
            this.socket.on('close', () => {
                this.rejectPending(new Error('Device helper disconnected before replying'));
                if (!this.shuttingDown) this.deviceDisconnectedCallback?.();
            });
            this.outStream = new PackrStream({
                copyBuffers: true,
                structuredClone: true,
            });
            this.socket.on('connect', (err: boolean) => {
                if(err){
                    console.log("Error!");
                    return
                }
                console.log('Connected');

                const unpackerStream = new UnpackrStream({
                    copyBuffers: true,
                    structuredClone: true,
                });
                this.socket.pipe(unpackerStream);
                this.outStream.pipe(this.socket);
                unpackerStream.on('data', ({ type, name, value, service }: { type: string, name: string, service: string, value: any }) => {
                    if(type === "return"){
                        if(name !== this.awaitingReturnName){
                            this.rejectPending(new Error(`Unexpected helper reply: ${name}`));
                            return;
                        }
                        const resolve = this.awaitingReturnResolve;
                        const reject = this.awaitingReturnReject;
                        this.clearPending();
                        // value is [out, err]
                        if(value[1]){
                            reject?.(value[1]);
                        }else{
                            resolve?.(value[0]);
                        }
                    }else if(type === "callback"){
                        this.callbackHandler?.(service, name, ...value);
                    }
                });
                res();
            });
            this.socket.connect(getSocketPath());
        });
    }

    private earlyTerminate = false;

    terminateAwaitConnection(){
        this.earlyTerminate = true;
    }

    async awaitConnection(){
        this.socket = null;
        this.earlyTerminate = false;
        console.log("Waiting for server to start...");
        await new Promise<void>(res => {
            let interval = setInterval(() => {
                try{
                    if(this.earlyTerminate || fs.statSync(getSocketPath()).isSocket()){
                        clearInterval(interval);
                        res();
                        return;
                    }
                }catch(ex){
                    //pass
                }
            }, 500);
        });
        if(this.earlyTerminate) {
            return new Error("Couldn't bring up the server!");
        }
        try{
            await this.connect();
        }catch(ex){
            this.socket = null;
            console.log(ex);
            return ex;
        }
        return null;
    }

    private clearPending() {
        this.awaitingReturnName = null;
        this.awaitingReturnResolve = null;
        this.awaitingReturnReject = null;
    }

    private rejectPending(error: Error) {
        const reject = this.awaitingReturnReject;
        this.clearPending();
        reject?.(error);
    }

    shutdown(): Promise<void> {
        if (this.shutdownRequest) return this.shutdownRequest;
        this.shuttingDown = true;
        if (!this.socket) return Promise.resolve();
        this.shutdownRequest = (async () => {
            if (this.socket.destroyed) {
                // The server unlinks its socket only after successful cleanup.
                // If it remains, reconnect to retry instead of abandoning it.
                if (!fs.existsSync(getSocketPath())) return;
                await this.connect(false);
            }
            const socket = this.socket;
            let onClose: () => void;
            const closed = new Promise<void>(resolve => {
                onClose = resolve;
                socket.once('close', onClose);
            });
            try {
                await this.callMethod('__lifecycle', 'shutdown');
                await closed;
            } finally { socket.removeListener('close', onClose); }
            this.socket = null;
        })().catch(error => {
            this.shutdownRequest = undefined;
            throw error;
        });
        return this.shutdownRequest;
    }

    callMethod(service: string, name: string, ...allArgs: any[]): Promise<any>{
        return new Promise((res, rej) => {
            if (!this.socket || this.socket.destroyed) return rej(new Error('Device helper is not connected'));
            if (this.shuttingDown && service !== '__lifecycle') return rej(new Error('Device helper is shutting down'));
            if (this.awaitingReturnName) return rej(new Error('A device helper request is already pending'));
            for (let i = 0; i < allArgs.length; i++) {
                if (typeof allArgs[i] === 'function') {
                    allArgs[i] = { interprocessType: 'function' };
                }
            }

            this.awaitingReturnName = name;
            this.awaitingReturnResolve = res;
            this.awaitingReturnReject = rej;
            this.outStream.write({
                service, name, allArgs
            })
        });
    }
}
