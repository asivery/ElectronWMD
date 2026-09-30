export type ShutdownLog = (stage: string, detail?: unknown) => void;

/** Keeps the runtime alive until admitted device operations and cleanup have finished. */
export class ShutdownCoordinator {
    private state: 'running' | 'draining' | 'failed' | 'closed' = 'running';
    private active = new Set<Promise<unknown>>();
    private steps: Array<{ name: string; run: () => Promise<void> }> = [];
    private attempt?: Promise<void>;
    private completed = new Set<string>();

    constructor(private log: ShutdownLog = () => {}, private onWaiting = () => {}, private waitMs = 10000) {}

    get stopping() { return this.state !== 'running'; }
    get closed() { return this.state === 'closed'; }
    get pendingCount() { return this.active.size; }

    add(name: string, run: () => Promise<void>) {
        this.steps.push({ name, run });
    }

    run<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
        if (this.stopping) return Promise.reject(new Error('ElectronWMD is shutting down; new device operations are disabled.'));
        // Register before executing so even synchronous/reentrant operations are tracked.
        const pending = Promise.resolve().then(operation);
        this.active.add(pending);
        this.log('operation-start', { name, pending: this.active.size });
        const finish = () => {
            this.active.delete(pending);
            this.log('operation-end', { name, pending: this.active.size });
        };
        pending.then(finish, finish);
        return pending;
    }

    shutdown(): Promise<void> {
        if (this.attempt) return this.attempt;
        if (this.closed) return Promise.resolve();
        this.state = 'draining';
        this.log('shutdown-start', { pending: this.active.size });
        const timer = setTimeout(() => {
            this.log('shutdown-waiting', { pending: this.active.size });
            this.onWaiting();
        }, this.waitMs);
        this.attempt = (async () => {
            await Promise.all(Array.from(this.active, p => p.catch(() => undefined)));
            for (const step of this.steps) {
                if (this.completed.has(step.name)) continue;
                this.log('cleanup-start', { name: step.name });
                await step.run();
                this.completed.add(step.name);
                this.log('cleanup-complete', { name: step.name });
            }
            this.state = 'closed';
            this.log('shutdown-complete');
        })().catch(error => {
            this.state = 'failed';
            this.attempt = undefined;
            this.log('shutdown-failed', String(error));
            throw error;
        }).finally(() => clearTimeout(timer));
        return this.attempt;
    }
}
