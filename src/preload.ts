import { contextBridge, ipcRenderer } from 'electron';
import { Codec, NetMDFactoryService } from './wmd/original/services/interfaces/netmd';
import type { Setting } from './main';

export type InlineChangelogEntry = 
    | string
    | { type: 'code', content: string }
    | { type: 'link', url?: string, clickHandler?: 'openSettings', content: string }

export type ChangelogEntry = 
    | InlineChangelogEntry
    | InlineChangelogEntry[]
    | { type: 'sublist', name: string, content: ChangelogEntry[] }

export interface ChangelogVersion {
    name: string;
    contents: ChangelogEntry[]
}

export interface ChangelogVersionInjection {
    entry: ChangelogVersion;
    before: string | null;
}

export const CHANGELOG: ChangelogVersionInjection[] = [
    {
        before: 'Version 1.5.0',
        entry: {
            name: 'ElectronWMD 0.5.0-1.5.0',
            contents: [
                "Add support for Sony Network Walkman devices",
                "Add support for running a local instance of the Sony ATRAC encoder",
                "Fix stability issues on HiMD device",
                "Overhauled settings - moved ElectronWMD settings to main settings dialog",
            ],
        }
    }
];

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
                console.log(`Invoke ${name}`);
                const [response, error] = await ipcRenderer.invoke(name, ...args);
                console.log(`Invoke ${name} done`);
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

            args[3].shouldCancelImmediately = { interprocessType: 'nestedFunction' } as any;
            args[3].handleBadSector = { interprocessType: 'nestedFunction' } as any;

            if(!shouldCancelImmediately) delete args[3].shouldCancelImmediately;
            if(!handleBadSector) delete args[3].handleBadSector;

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
    const nwjsIface: any = {};
    await loadNamespaced(nwjsIface, "_nwjs_");

    async function unrestrictedFetchJSON(url: string, parameters: any) {
        return JSON.parse(await ipcRenderer.invoke('_unrestrictedFetch', url, parameters));
    }

    async function signHiMDDisc(){
        await ipcRenderer.invoke("_signHiMDDisc");
    }

    async function invokeLocalEncoder(ffmpegPath: string, encoderPath: string, data: ArrayBuffer, sourceFilename: string, parameters: { format: Codec, enableReplayGain?: boolean }) {
        return await ipcRenderer.invoke("invokeLocalEncoder", ffmpegPath, encoderPath, data, sourceFilename, parameters);
    }

    function openFileHostDialog(filters: string[], directory?: boolean): Promise<string | null> {
        return ipcRenderer.invoke('openFileHostDialog', filters, directory);
    }

    function reload(){
        return ipcRenderer.invoke('reload');
    }

    contextBridge.exposeInMainWorld('native', {
        unrestrictedFetchJSON,

        getSettings: loadSettings,

        interface: iface,
        himdFullInterface: himdIface,
        nwInterface: nwjsIface,
        signHiMDDisc,
        openFileHostDialog,
        reload,

        invokeLocalEncoder,

        wrapperChangelog: CHANGELOG,

        _debug_himdPullFile: (a: string, b: string) => ipcRenderer.invoke('_debug_himdPullFile', a, b),
        _debug_himdList: (a: string) => ipcRenderer.invoke('_debug_himdList', a),
    });

    console.log('====PRELOAD COMPLETE====');
    console.groupEnd();
})();

interface SettingInterface extends Setting {
    update(newValue: boolean | string | number): Promise<void>;
}

async function loadSettings(): Promise<SettingInterface[]>{
    const settings: Setting[] = await ipcRenderer.invoke("fetch_settings_list");
    return settings
        .map(e => ({...e, update: async (newValue: any) => {
            await ipcRenderer.invoke("setting_update", e.name, newValue);
        }}));
}
