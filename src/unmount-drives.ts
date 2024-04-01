import { join as pathJoin } from 'path';
import { exec } from 'child_process';

export async function unmountAll(vid: number, pid: number){
    await new Promise<void>(res => {
        exec([
            pathJoin(__dirname, "..", "res", "unix-unmount.sh"),
            vid.toString(16).padStart(4, '0'),
            pid.toString(16).padStart(4, '0'),
        ].join(' '), (err, stdout, stderr) => {
            console.log(err);
            console.log(stdout);
            console.log(stderr);
            res();
        });
    });
}
