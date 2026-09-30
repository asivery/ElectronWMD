import fs from 'fs';
import path from 'path';
import { ShutdownLog } from './shutdown';

export function createShutdownLog(directory: string, processName: string): ShutdownLog {
    const filename = path.join(directory, `shutdown-${processName}.log`);
    return (stage, detail) => {
        const line = JSON.stringify({ time: new Date().toISOString(), pid: process.pid, stage, detail });
        console.log(`[shutdown] ${line}`);
        try {
            fs.mkdirSync(directory, { recursive: true });
            if (fs.existsSync(filename) && fs.statSync(filename).size > 1024 * 1024) {
                fs.renameSync(filename, filename + '.old');
            }
            fs.appendFileSync(filename, line + '\n');
        } catch (error) { console.error('Unable to write shutdown log:', error); }
    };
}
