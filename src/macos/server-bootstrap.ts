import { exec as sudoExec } from 'sudo-prompt';
import { join as pathJoin } from 'path';
import { app, dialog } from 'electron';
import { Socket } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';

export function getSocketName(){
    return pathJoin(process.env['TMPDIR'] || '/tmp/', 'ewmd-intermediary.sock');
}

export function startServer(){
    const executablePath = app.getPath('exe');
    const serverPath = pathJoin(app.getAppPath(), "macos", "server.js");
    return new Promise<void>((res) => 
        sudoExec(`ELECTRON_RUN_AS_NODE=1 ${executablePath.replace(" ", "\\ ")} ${serverPath.replace(" ", "\ ")}`, {
            name: "ElectronWMD",
        }, (err, stdout, stderr) => {
            if(err){
                dialog.showErrorBox("ElectronWMD Error", "Couldn't start the ElectronWMD intermediary HiMD server: \n" + err);
            }
            res();
        })
    );
}

export class Connection {
    socket: Socket;
    outStream = new PackrStream();
    
    awaitingReturnName: string | null = null;
    awaitingReturnResolve: ((obj: any) => void) | null = null;
    awaitingReturnReject: ((obj: any) => void) | null = null;

    callbackHandler: ((name: string, ...args: any[]) => void) | null = null;

    connect(){
        this.socket = new Socket();
        this.socket.on('connect', (err: boolean) => {
            if(err){
                console.log("Error!");
                return
            }
            console.log('Connected');

            const unpackerStream = new UnpackrStream();
            this.socket.pipe(unpackerStream);
            this.outStream.pipe(this.socket);
            unpackerStream.on('data', ({ type, name, value }: { type: string, name: string, value: any }) => {
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
                    this.callbackHandler?.(name, ...value);
                }
            })
        });
        this.socket.connect(getSocketName());
    }

    disconnect(){
        this.socket.destroy();
    }

    callMethod(name: string, ...allArgs: any[]): Promise<any>{
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
                name, allArgs
            })
        });
    }
}