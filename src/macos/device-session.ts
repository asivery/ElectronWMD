import { Mutex } from 'async-mutex';
import { Connection, startServer } from './server-bootstrap';
import fs from 'fs';

/** Serializes helper restarts with device RPCs and shares overlapping connect requests. */
export class DeviceHelperSession {
    private mutex = new Mutex();
    private connects = new Map<string, Promise<any>>();
    private startup = new AbortController();
    private startupError?: unknown;

    constructor(
        readonly connection = new Connection(),
        private launch: (signal: AbortSignal) => Promise<string> = signal => startServer(undefined, signal),
        private onConnected = () => {},
    ) {}

    cancelStartup() { this.startup.abort(); }

    call(service: string, method: string, ...args: any[]): Promise<any> {
        if (method === 'connect' && this.connects.has(service)) return this.connects.get(service)!;
        const request = this.mutex.runExclusive(async () => {
            if (method === 'connect') {
                this.startupError = undefined;
                try {
                    if (this.startup.signal.aborted) throw new Error('Device connection cancelled.');
                    if (this.connection.socket) await this.connection.shutdown();
                    const logPath = await this.launch(this.startup.signal);
                    try {
                        await this.connection.awaitConnection(this.startup.signal);
                    } catch (error) {
                        if (this.startup.signal.aborted) throw error;
                        let detail = '';
                        try {
                            // Read only the last 8 KiB, even if a debug log is large.
                            const fd = fs.openSync(logPath, 'r');
                            try {
                                const size = fs.fstatSync(fd).size;
                                const buffer = Buffer.alloc(Math.min(size, 8192));
                                const length = fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
                                detail = buffer.subarray(0, length).toString('utf8').trim();
                            } finally { fs.closeSync(fd); }
                        } catch (_) { /* Keep the original startup error if the log is unavailable. */ }
                        throw new Error(`${String(error)}${detail ? `\n${detail}` : ''}\nHelper log: ${logPath}`);
                    }
                    if (this.startup.signal.aborted) throw new Error('Device connection cancelled.');
                    this.onConnected();
                } catch (error) {
                    this.startupError = error;
                    throw error;
                }
            } else if (this.startupError) {
                // The renderer tries pair() after connect() fails. Keep the actual
                // authorization/startup error instead of replacing it with "not connected".
                throw this.startupError;
            }
            return this.connection.callMethod(service, method, ...args);
        });
        if (method === 'connect') {
            this.connects.set(service, request);
            const clear = () => this.connects.delete(service);
            request.then(clear, clear);
        }
        return request;
    }

    shutdown() {
        this.cancelStartup();
        return this.mutex.runExclusive(() => this.connection.shutdown());
    }
}
