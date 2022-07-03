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
            for(let i = 0; i<args.length; i++){
                if(typeof args[i] === "function"){
                    callbacks[`${name}_callback${i}`] = args[i];
                    args[i] = { interprocessType: "function" };
                }
            }
            const [ response, error ] = await ipcRenderer.invoke(name, ...args);
            if(error) throw error;
            return await response;
        }
        console.log(`Registering invoker for #${i++}(${name})`);
    }

    iface["factory"] = async () => {
        const factoryDefined = await ipcRenderer.invoke("_switchToFactory");
        const factoryIface: {[key: string]: any} = {};
        for(const name of factoryDefined){
            factoryIface[name.substring("_factory__".length)] = async (...args: any[]) => {
                for(let i = 0; i<args.length; i++){
                    if(typeof args[i] === "function"){
                        callbacks[`${name}_callback${i}`] = args[i];
                        args[i] = { interprocessType: "function" };
                    }
                }
                const [ response, error ] = await ipcRenderer.invoke(name, ...args);
                if(error) throw error;
                return await response;
            }
        }
        return factoryIface;
    }

    contextBridge.exposeInMainWorld("native", {
        interface: iface
    });

    console.log("====PRELOAD COMPLETE====");
    console.groupEnd();

})();
