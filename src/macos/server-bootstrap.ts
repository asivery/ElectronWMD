import { spawn } from 'child_process'
import { join as pathJoin } from 'path';
import { app } from 'electron';
import { Socket } from 'net';
import { PackrStream, UnpackrStream } from 'msgpackr';
import fs from 'fs';
import { getSocketDir, getSocketPath } from './socket-path';

export function startServer(workDir?: string, signal?: AbortSignal) {
    return startOutsideElectron(
        app.getPath('exe'),
        app.getAppPath(),
        app.getPath('userData'),
        workDir,
        signal,
    );
}

function shellQuote(value: string) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

function appleScriptQuote(value: string) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '"';
}

export function startOutsideElectron(executablePath: string, applicationRoot: string, userDataPath: string, workDir?: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(new Error('Device connection cancelled.'));
    // The server checks its PID before removing stale files. Do not unlink a
    // live helper's socket here: it may still be finishing a write.

    let serverPath = pathJoin(applicationRoot, "dist", "macos", "server.js");
    if(!fs.existsSync(serverPath)) {
        serverPath = pathJoin(applicationRoot, "macos", "server.js");
    }
    const envs = [
        'ELECTRON_RUN_AS_NODE=1',
        `EWWORKDIR=${getSocketDir(workDir)}`,
        `ORIGINAL_UID=${process.getuid!()}`,
        `ORIGINAL_GID=${process.getgid!()}`,
    ];
    if(process.env.EWMD_HIMD_BYPASS_COHERENCY_CHECK) {
        envs.push(`EWMD_HIMD_BYPASS_COHERENCY_CHECK=${process.env.EWMD_HIMD_BYPASS_COHERENCY_CHECK}`);
    }
    // Open the private log as root before handing ownership to the calling user.
    // Redirect all descriptors so AppleScript returns while the helper runs.
    // macOS nohup tries to detach from a console when run as root and fails in
    // Authorization Services' console-less context. Ignore HUP in the shell instead.
    const command = [
        'umask 077',
        'log_dir=$(/usr/bin/mktemp -d /tmp/ewmd-helper.XXXXXX) || exit 1',
        'exec 3> "$log_dir/helper.log"',
        `/usr/sbin/chown ${shellQuote(`${process.getuid!()}:${process.getgid!()}`)} "$log_dir" "$log_dir/helper.log" || exit 1`,
        `(trap '' HUP; exec /usr/bin/env ${[...envs, executablePath, serverPath, userDataPath].map(shellQuote).join(' ')}) < /dev/null >&3 2>&1 3>&- &`,
        'exec 3>&-',
        '/usr/bin/printf \'%s\' "$log_dir/helper.log"',
    ].join('\n');
    const script = `do shell script ${appleScriptQuote(command)} with administrator privileges with prompt "WMD needs administrator access to connect your Hi-MD or Network Walkman."`;
    return new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let errors = '';
        const cancel = () => {
            child.kill();
            reject(new Error('Device connection cancelled.'));
        };
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        child.stdout.on('data', data => { output = (output + data).slice(-8192); });
        child.stderr.on('data', data => { errors = (errors + data).slice(-8192); });
        child.once('error', error => { cleanup(); reject(error); });
        child.once('close', code => {
            cleanup();
            if (signal?.aborted) reject(new Error('Device connection cancelled.'));
            else if (code === 0) resolve(output.trim());
            else if (/\(-128\)/.test(errors)) reject(new Error('Administrator authorization was cancelled. Please connect again to retry.'));
            else reject(new Error(`Unable to start the device helper: ${errors.trim() || `osascript exited with code ${code}`}`));
        });
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
    });
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
            const socket = this.socket;
            let connected = false;
            socket.on('error', error => {
                this.rejectPending(error);
                reject(error);
            });
            socket.on('close', () => {
                if (connected) this.rejectPending(new Error('Device helper disconnected before replying'));
                if (connected && !this.shuttingDown) this.deviceDisconnectedCallback?.();
            });
            this.outStream = new PackrStream({
                copyBuffers: true,
                structuredClone: true,
            });
            socket.on('connect', () => {
                connected = true;
                console.log('Connected');

                const unpackerStream = new UnpackrStream({
                    copyBuffers: true,
                    structuredClone: true,
                });
                socket.pipe(unpackerStream);
                this.outStream.pipe(socket);
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
            socket.connect(getSocketPath());
        });
    }

    private cancelAwait?: () => void;

    terminateAwaitConnection(){
        this.cancelAwait?.();
    }

    awaitConnection(signal?: AbortSignal, timeoutMs = 30000): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            let retry: ReturnType<typeof setTimeout>;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                clearTimeout(retry);
                signal?.removeEventListener('abort', cancel);
                this.cancelAwait = undefined;
                if (error) {
                    this.shuttingDown = true;
                    this.socket?.destroy();
                    this.socket = null;
                    reject(error);
                } else resolve();
            };
            const cancel = () => finish(new Error('Device connection cancelled.'));
            const timeout = setTimeout(() => finish(new Error(`Device helper did not become ready within ${timeoutMs / 1000} seconds. Please reconnect.`)), timeoutMs);
            this.cancelAwait = cancel;
            signal?.addEventListener('abort', cancel, { once: true });
            const attempt = () => {
                if (settled) return;
                this.connect().then(() => finish(), (error: NodeJS.ErrnoException) => {
                    if (settled) return;
                    this.socket?.destroy();
                    this.socket = null;
                    if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') retry = setTimeout(attempt, 100);
                    else finish(error);
                });
            };
            if (signal?.aborted) cancel(); else attempt();
        });
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
        this.terminateAwaitConnection();
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
