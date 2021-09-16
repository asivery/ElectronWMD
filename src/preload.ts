import {
    contextBridge,
    ipcRenderer
} from 'electron';


(async () => {
    console.group("PRELOAD");
    console.log("====PRELOAD START====");
    const defined = await ipcRenderer.invoke("_definedParameters");
    const iface : {[key: string]: any} = {};

    let i = 0;

    let callbacks: {[key: string]: (...args: any[]) => void} = {};
    ipcRenderer.on("_callback", (evt, cbname, ...args) => callbacks[cbname](...args));

    for(const name of defined){
        iface[name] = (...args: any[]) => {
            const registeredForThis = new Set<string>();
            for(let i = 0; i<args.length; i++){
                if(typeof args[i] === "function"){
                    callbacks[`${name}_callback${i}`] = args[i];
                    registeredForThis.add(`${name}_callback${i}`);
                    args[i] = { interprocessType: "function" };
                }
            }

            return new Promise(async (res, err) => ipcRenderer.invoke(name, ...args).then((...rargs) => {
                registeredForThis.forEach(n => delete callbacks[n]);
                //Remove all the callbacks first
                res(...rargs);
            }).catch(err));
        }
        console.log(`Registering invoker for #${i++}(${name})`);
    }

    contextBridge.exposeInMainWorld("native", {
        interface: iface
    });

    console.log("====PRELOAD COMPLETE====");
    console.groupEnd();

})();