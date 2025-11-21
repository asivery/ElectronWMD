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
    const canFail = (func: () => void) => {
        try{ func() } catch(_){}
    }
    canFail(() => fs.unlinkSync(socketName));

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

    connect(){
        return new Promise<void>(res => {
            this.socket = new Socket();
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
                            console.log(`Mismatch between awaited return and actual (${this.awaitingReturnName} != ${name})`);
                            this.awaitingReturnReject("mismatch");
                        }
                        // value is [out, err]
                        if(value[1]){
                            this.awaitingReturnReject(value[1]);
                        }else{
                            this.awaitingReturnResolve(value[0]);
                        }
                    }else if(type === "callback"){
                        this.callbackHandler?.(service, name, ...value);
                    }
                });
                if(this.deviceDisconnectedCallback) {
                    this.socket.on('close', this.deviceDisconnectedCallback);
                }
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

    disconnect(){
        this.socket.removeAllListeners('close');
        this.socket.destroy();
    }

    callMethod(service: string, name: string, ...allArgs: any[]): Promise<any>{
        return new Promise((res, rej) => {
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
