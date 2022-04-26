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
        iface[name] = async (...args: any[]) => {
            const registeredForThis = new Set<string>();
            for(let i = 0; i<args.length; i++){
                if(typeof args[i] === "function"){
                    callbacks[`${name}_callback${i}`] = args[i];
                    registeredForThis.add(`${name}_callback${i}`);
                    args[i] = { interprocessType: "function" };
                }
            }
            const [ response, error ] = await ipcRenderer.invoke(name, ...args);
            if(error) throw error;
            return await response;
        }
        console.log(`Registering invoker for #${i++}(${name})`);
    }

    contextBridge.exposeInMainWorld("native", {
        interface: iface
    });

    console.log("====PRELOAD COMPLETE====");
    console.groupEnd();

})();
