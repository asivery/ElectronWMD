import { contextBridge, ipcRenderer } from 'electron';
import { NetMDFactoryService } from './wmd/original/services/interfaces/netmd';

(async () => {
    console.group('PRELOAD');
    console.log('====PRELOAD START====');
    const iface: { [key: string]: any } = {};

    let i = 0;

    let callbacks: { [key: string]: (...args: any[]) => void } = {};
    ipcRenderer.on('_callback', (evt, cbname, ...args) => callbacks[cbname](...args));

    async function loadNamespaced(target: any, namespace: string){
        console.group(`Loading namespace ${namespace}`);
        const defined = await ipcRenderer.invoke(namespace + '_definedParameters');
        for (const name of defined) {
            target[name.substring(namespace.length)] = async (...args: any[]) => {
                for (let i = 0; i < args.length; i++) {
                    if (typeof args[i] === 'function') {
                        callbacks[`${name}_callback${i}`] = args[i];
                        console.log(`Registered callback ${name}_callback${i}`);
                        args[i] = { interprocessType: 'function' };
                    }
                }
                const [response, error] = await ipcRenderer.invoke(name, ...args);
                if (error) throw error;
                return await response;
            };
            console.log(`Registering invoker for #${i++}(${name}) as ${name.substring(namespace.length)}`);
        }
        console.groupEnd();
    }

    await loadNamespaced(iface, "_netmd_");
    iface['factory'] = async () => {
        const factoryDefined = await ipcRenderer.invoke('_switchToFactory');
        const factoryIface: { [key: string]: any } = {};
        for (const name of factoryDefined) {
            factoryIface[name.substring('_factory__'.length)] = async (...args: any[]) => {
                for (let i = 0; i < args.length; i++) {
                    if (typeof args[i] === 'function') {
                        callbacks[`${name}_callback${i}`] = args[i];
                        args[i] = { interprocessType: 'function' };
                    }
                }
                const [response, error] = await ipcRenderer.invoke(name, ...args);
                if (error) console.log("(On Node side)");
                if (error) throw error;
                return await response;
            };
        }

        // See note in main.ts
        factoryIface['exploitDownloadTrack'] = async (...args: Parameters<NetMDFactoryService['exploitDownloadTrack']>) => {
            let interval: NodeJS.Timeout | null = null;

            const shouldCancelImmediately = args[3].shouldCancelImmediately;
            const handleBadSector = args[3].handleBadSector;
            callbacks[`_factory__exploitDownloadTrack_callback2`] = args[2];

            args[3].shouldCancelImmediately = shouldCancelImmediately ? { interprocessType: 'nestedFunction' } as any : null;
            args[3].handleBadSector = handleBadSector ? { interprocessType: 'nestedFunction' } as any : null;
            args[2] = { interprocessType: 'function' } as any;
            if(shouldCancelImmediately){
                interval = setInterval(() => {
                    if(shouldCancelImmediately()){
                        ipcRenderer.invoke('_atracdl_cancel');
                    }
                }, 1000);
            }

            ipcRenderer.removeAllListeners('_atracdl_callback_handleBadSector');
            ipcRenderer.on('_atracdl_callback_handleBadSector', async (evt, ...args: Parameters<typeof handleBadSector>) => {
                const response = await handleBadSector(...args);
                await ipcRenderer.invoke('_atracdl_callback_handleBadSector_return', response);
            });

            const [response, error] = await ipcRenderer.invoke('_factory__exploitDownloadTrack', ...args);
            if(interval !== null) clearInterval(interval);
            if (error) console.log("(On Node side)");
            if (error) throw error;
            return response;
        }

        return factoryIface;
    };

    const himdIface: any = {};
    await loadNamespaced(himdIface, "_himd_");

    async function unrestrictedFetchJSON(url: string, parameters: any) {
        return JSON.parse(await ipcRenderer.invoke('_unrestrictedFetch', url, parameters));
    }

    contextBridge.exposeInMainWorld('native', {
        interface: iface,
        himdFullInterface: himdIface,
        unrestrictedFetchJSON,
    });

    console.log('====PRELOAD COMPLETE====');
    console.groupEnd();
})();
