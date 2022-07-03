import {
    openNewDevice,
    NetMDInterface,
    Disc,
    listContent,
    openPairedDevice,
    Wireformat,
    MDTrack,
    download,
    getDeviceStatus,
    DeviceStatus,
    Group,
    renameDisc,
    DiscFormat,
    upload,
    rewriteDiscGroups,
    DiscFlag,
    EKBOpenSource,
    MDSession,
    prepareDownload,
    NetMDFactoryInterface,
    readUTOCSector,
    writeUTOCSector,
    getDescriptiveDeviceCode,
    cleanRead,
    MemoryType,
} from 'netmd-js';
import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import { Worker } from 'worker_threads';
import { Logger } from 'netmd-js/dist/logger';
import path from 'path';

import { sanitizeHalfWidthTitle, sanitizeFullWidthTitle, concatUint8Arrays } from 'netmd-js/dist/utils';
import { asyncMutex, sleep, isSequential, recomputeGroupsAfterTrackMove } from './utils';
import { Mutex } from 'async-mutex';
import { CachedSectorAtracDownload, ExploitStateManager, FirmwareDumper, ForceTOCEdit, isCompatible, Tetris } from 'netmd-exploits';

export enum Capability {
    contentList,
    playbackControl,
    metadataEdit,
    trackUpload,
    trackDownload,
    discEject,
    factoryMode,
}

export enum ExploitCapability {
    runTetris,
    flushUTOC,
    downloadAtrac,
    readFirmware,
}

export interface NetMDService {
    mutex: Mutex;
    getServiceCapabilities(): Promise<Capability[]>;
    getDeviceStatus(): Promise<DeviceStatus>;
    pair(): Promise<boolean>;
    connect(): Promise<boolean>;
    listContent(): Promise<Disc>;
    getDeviceName(): Promise<string>;
    finalize(): Promise<void>;
    renameTrack(index: number, newTitle: string, newFullWidthTitle?: string): Promise<void>;
    renameDisc(newName: string, newFullWidthName?: string): Promise<void>;
    renameGroup(groupIndex: number, newTitle: string, newFullWidthTitle?: string): Promise<void>;
    addGroup(groupBegin: number, groupLength: number, name: string): Promise<void>;
    deleteGroup(groupIndex: number): Promise<void>;
    rewriteGroups(groups: Group[]): Promise<void>;
    deleteTracks(indexes: number[]): Promise<void>;
    moveTrack(src: number, dst: number, updateGroups?: boolean): Promise<void>;
    wipeDisc(): Promise<void>;
    ejectDisc(): Promise<void>;
    wipeDiscTitleInfo(): Promise<void>;
    prepareUpload(): Promise<void>;
    finalizeUpload(): Promise<void>;
    upload(
        title: string,
        fullWidthTitle: string,
        data: ArrayBuffer,
        format: Wireformat,
        progressCallback: (progress: { written: number; encrypted: number; total: number }) => void
    ): Promise<void>;
    download(
        index: number,
        progressCallback: (progress: { read: number; total: number }) => void
    ): Promise<{ format: DiscFormat; data: Uint8Array } | null>;
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    gotoTrack(index: number): Promise<void>;
    gotoTime(index: number, hour: number, minute: number, second: number, frame: number): Promise<void>;
    getPosition(): Promise<number[] | null>;
    factory(): Promise<NetMDFactoryService | null>;
}

export interface NetMDFactoryService {
    mutex: Mutex;
    readUTOCSector(index: number): Promise<Uint8Array>;
    writeUTOCSector(index: number, data: Uint8Array): Promise<void>;
    getDeviceFirmware(): Promise<string>;
    getExploitCapabilities(): Promise<ExploitCapability[]>;
    readRAM(callback?: (progress: { readBytes: number; totalBytes: number }) => void): Promise<Uint8Array>;

    // depend on netmd-exploits:
    flushUTOCCacheToDisc(): Promise<void>;
    runTetris(): Promise<void>;
    readFirmware(callback: (progress: { type: 'RAM' | 'ROM'; readBytes: number; totalBytes: number }) => void): Promise<Uint8Array>;
    exploitDownloadTrack(
        track: number,
        callback: (progress: { sectorsRead: number; totalSectors: number; action: 'READ' | 'SEEK'; sector?: string }) => void
    ): Promise<Uint8Array>;
}

export class NetMDUSBService implements NetMDService {
    private netmdInterface?: NetMDInterface;
    private currentSession?: MDSession;
    private logger?: Logger;
    private cachedContentList?: Disc;
    public mutex = new Mutex();
    public statusMonitorTimer: any;

    constructor({ debug = false }: { debug: boolean }) {
        if (debug) {
            // Logging a few methods that have been causing issues with some units
            const _fn = (...args: any) => {
                if (args && args[0] && args[0].method) {
                    console.log(...args);
                }
            };
            this.logger = {
                debug: _fn,
                info: _fn,
                warn: _fn,
                error: _fn,
                child: () => this.logger!,
            };
        }
    }

    @asyncMutex
    async getServiceCapabilities() {
        const basic = [Capability.contentList, Capability.playbackControl];
        if (this.netmdInterface?.netMd.getVendor() === 0x54c && this.netmdInterface.netMd.getProduct() === 0x0286) {
            // MZ-RH1
            basic.push(Capability.trackDownload);
        }
        if (await this.netmdInterface?.canEjectDisc()){
            basic.push(Capability.discEject);
        }

        // TODO: Add a flag for this instead of relying just on the name.
        const deviceName = this.netmdInterface?.netMd.getDeviceName();
        if (
            (deviceName?.includes('Sony') && (deviceName?.includes('MZ-N') || deviceName?.includes("MZ-S1")) && !deviceName.includes('MZ-NH')) ||
            (deviceName?.includes('Aiwa') && deviceName?.includes('AM-NX'))
        ) {
            // Only non-HiMD Sony (and Aiwa since it's the same thing) portables have the factory mode.
            basic.push(Capability.factoryMode);
        }

        try{
            const flags = await this.netmdInterface?.getDiscFlags() ?? 0;
            if (!(flags & DiscFlag.writeProtected)) {
                return [...basic, Capability.trackUpload, Capability.metadataEdit];
            }
        }catch(err){}
        return basic;
    }

    private async listContentUsingCache() {
        if (!this.cachedContentList) {
            console.log("There's no cached version of the TOC, caching");
            this.cachedContentList = await listContent(this.netmdInterface!);
        } else {
            console.log("There's a cached TOC available.");
        }
        return JSON.parse(JSON.stringify(this.cachedContentList)) as Disc;
    }

    private dropCachedContentList() {
        console.log('Cached TOC Dropped');
        this.cachedContentList = undefined;
    }

    async pair() {
        this.dropCachedContentList();
        let iface = await openNewDevice(navigator.usb, this.logger);
        if (iface === null) {
            return false;
        }
        this.netmdInterface = iface;
        return true;
    }

    async connect() {
        this.dropCachedContentList();
        let iface = await openPairedDevice(navigator.usb, this.logger);
        if (iface === null) {
            return false;
        }
        this.netmdInterface = iface;
        return true;
    }

    @asyncMutex
    async listContent() {
        this.dropCachedContentList();
        return await this.listContentUsingCache();
    }

    @asyncMutex
    async getDeviceStatus() {
        return await getDeviceStatus(this.netmdInterface!);
    }

    @asyncMutex
    async getDeviceName() {
        return await this.netmdInterface!.netMd.getDeviceName();
    }

    @asyncMutex
    async finalize() {
        await this.netmdInterface!.netMd.finalize();
        this.dropCachedContentList();
    }

    @asyncMutex
    async rewriteGroups(groups: Group[]) {
        const disc = await this.listContentUsingCache();
        disc.groups = groups;
        await rewriteDiscGroups(this.netmdInterface!, disc);
    }

    @asyncMutex
    async renameTrack(index: number, title: string, fullWidthTitle?: string) {
        title = sanitizeHalfWidthTitle(title);
        await this.netmdInterface!.setTrackTitle(index, title);
        if (fullWidthTitle !== undefined) {
            await this.netmdInterface!.setTrackTitle(index, sanitizeFullWidthTitle(fullWidthTitle), true);
        }
        this.dropCachedContentList();
    }

    @asyncMutex
    async renameGroup(groupIndex: number, newName: string, newFullWidthName?: string) {
        const disc = await this.listContentUsingCache();
        let thisGroup = disc.groups.find(g => g.index === groupIndex);
        if (!thisGroup) {
            return;
        }

        thisGroup.title = newName;
        if (newFullWidthName !== undefined) {
            thisGroup.fullWidthTitle = newFullWidthName;
        }
        await rewriteDiscGroups(this.netmdInterface!, disc);
    }

    @asyncMutex
    async addGroup(groupBegin: number, groupLength: number, title: string) {
        const disc = await this.listContentUsingCache();
        let ungrouped = disc.groups.find(n => n.title === null);
        if (!ungrouped) {
            return; // You can only group tracks that aren't already in a different group, if there's no such tracks, there's no point to continue
        }

        let ungroupedLengthBeforeGroup = ungrouped.tracks.length;

        let thisGroupTracks = ungrouped.tracks.filter(n => n.index >= groupBegin && n.index < groupBegin + groupLength);
        ungrouped.tracks = ungrouped.tracks.filter(n => !thisGroupTracks.includes(n));

        if (ungroupedLengthBeforeGroup - ungrouped.tracks.length !== groupLength) {
            throw new Error('A track cannot be in 2 groups!');
        }

        if (!isSequential(thisGroupTracks.map(n => n.index))) {
            throw new Error('Invalid sequence of tracks!');
        }

        disc.groups.push({
            title,
            fullWidthTitle: '',
            index: disc.groups.length,
            tracks: thisGroupTracks,
        });
        disc.groups = disc.groups.filter(g => g.tracks.length !== 0).sort((a, b) => a.tracks[0].index - b.tracks[0].index);
        await rewriteDiscGroups(this.netmdInterface!, disc);
    }

    @asyncMutex
    async deleteGroup(index: number) {
        const disc = await this.listContentUsingCache();

        let groupIndex = disc.groups.findIndex(g => g.index === index);
        if (groupIndex >= 0) {
            disc.groups.splice(groupIndex, 1);
        }
        
        this.cachedContentList = disc;
        await rewriteDiscGroups(this.netmdInterface!, disc);
    }

    @asyncMutex
    async renameDisc(newName: string, newFullWidthName?: string) {
        await renameDisc(this.netmdInterface!, newName, newFullWidthName);
        this.dropCachedContentList();
    }

    @asyncMutex
    async deleteTracks(indexes: number[]) {
        try{
            await this.netmdInterface!.stop();
        }catch(ex){}
        indexes = indexes.sort();
        indexes.reverse();
        let content = await this.listContentUsingCache();
        for (let index of indexes) {
            content = recomputeGroupsAfterTrackMove(content, index, -1);
            await this.netmdInterface!.eraseTrack(index);
            await sleep(100);
        }
        await rewriteDiscGroups(this.netmdInterface!, content);
        this.dropCachedContentList();
    }

    @asyncMutex
    async wipeDisc() {
        try{
            await this.netmdInterface!.stop();
        }catch(ex){}
        await this.netmdInterface!.eraseDisc();
        this.dropCachedContentList();
    }

    @asyncMutex
    async ejectDisc() {
        await this.netmdInterface!.ejectDisc();
        this.dropCachedContentList();
    }

    @asyncMutex
    async wipeDiscTitleInfo() {
        await this.netmdInterface!.setDiscTitle('');
        await this.netmdInterface!.setDiscTitle('', true);
    }

    @asyncMutex
    async moveTrack(src: number, dst: number, updateGroups?: boolean) {
        await this.netmdInterface!.moveTrack(src, dst);

        if (updateGroups === undefined || updateGroups) {
            await rewriteDiscGroups(this.netmdInterface!, recomputeGroupsAfterTrackMove(await this.listContentUsingCache(), src, dst));
        }
        this.dropCachedContentList();
    }

    @asyncMutex
    async prepareUpload() {
        await prepareDownload(this.netmdInterface!);
        this.currentSession = new MDSession(this.netmdInterface!, new EKBOpenSource());
        await this.currentSession.init();
    }

    @asyncMutex
    async finalizeUpload() {
        await this.currentSession!.close();
        await this.netmdInterface!.release();
        this.currentSession = undefined;
        this.dropCachedContentList();
    }


    async upload(
        title: string,
        fullWidthTitle: string,
        data: ArrayBuffer,
        format: Wireformat,
        progressCallback: (progress: { written: number; encrypted: number; total: number }) => void
    ) {
        if (this.currentSession === undefined) {
            throw new Error('Cannot upload without initializing a session first');
        }
        let total = data.byteLength;
        let written = 0;
        let encrypted = 0;
        function updateProgress() {
            progressCallback({ written, encrypted, total });
        }
        const w = new Worker(process.env.NODE_ENV === 'development' ?
         path.join(__dirname, "..", "..", "node_modules", "netmd-js", "dist", "node-encrypt-worker.js") :
         path.join(__dirname, "..", "..", "..", "app.asar.unpacked", "node_modules", "netmd-js", "dist", "node-encrypt-worker.js"));

        let webWorkerAsyncPacketIterator = makeGetAsyncPacketIteratorOnWorkerThread(w, ({ encryptedBytes }) => {
            encrypted = encryptedBytes;
            updateProgress();
        });

        let halfWidthTitle = sanitizeHalfWidthTitle(title);
        fullWidthTitle = sanitizeFullWidthTitle(fullWidthTitle);
        let mdTrack = new MDTrack(halfWidthTitle, format, data, 0x80000, fullWidthTitle, webWorkerAsyncPacketIterator);

        await this.currentSession.downloadTrack(mdTrack, ({ writtenBytes }) => {
            written = writtenBytes;
            updateProgress();
        });

        w.terminate();
    }

    async download(index: number, progressCallback: (progress: { read: number; total: number }) => void) {
        const [format, data] = await upload(this.netmdInterface!, index, ({ readBytes, totalBytes }) => {
            progressCallback({ read: readBytes, total: totalBytes });
        });
        return { format, data };
    }

    @asyncMutex
    async play() {
        await this.netmdInterface!.play();
    }
    @asyncMutex
    async pause() {
        await this.netmdInterface!.pause();
    }
    @asyncMutex
    async stop() {
        await this.netmdInterface!.stop();
    }
    @asyncMutex
    async next() {
        await this.netmdInterface!.nextTrack();
    }
    @asyncMutex
    async prev() {
        await this.netmdInterface!.previousTrack();
    }

    @asyncMutex
    async gotoTrack(index: number) {
        await this.netmdInterface!.gotoTrack(index);
    }

    @asyncMutex
    async gotoTime(index: number, h: number, m: number, s: number, f: number) {
        await this.netmdInterface!.gotoTime(index, h, m, s, f);
    }

    @asyncMutex
    async getPosition() {
        return await this.netmdInterface!.getPosition();
    }

    @asyncMutex
    async factory() {
        try {
            await this.netmdInterface!.stop();
        } catch (_) {
            /*Ignore*/
        }
        const factoryInstance = await this.netmdInterface!.factory();
        const esm = await ExploitStateManager.create(this.netmdInterface!, factoryInstance);
        return new NetMDFactoryUSBService(factoryInstance, this.mutex, esm);
    }
}

class NetMDFactoryUSBService implements NetMDFactoryService {
    constructor(private factoryInterface: NetMDFactoryInterface, public mutex: Mutex, public exploitStateManager: ExploitStateManager) {}
    async getExploitCapabilities() {
        let capabilities = [];
        if (isCompatible(CachedSectorAtracDownload, this.exploitStateManager.versionCode))
            capabilities.push(ExploitCapability.downloadAtrac);
        if (isCompatible(Tetris, this.exploitStateManager.versionCode)) capabilities.push(ExploitCapability.runTetris);
        if (isCompatible(ForceTOCEdit, this.exploitStateManager.versionCode)) capabilities.push(ExploitCapability.flushUTOC);

        return capabilities;
    }

    @asyncMutex
    async readUTOCSector(index: number) {
        return await readUTOCSector(this.factoryInterface, index);
    }

    @asyncMutex
    async writeUTOCSector(index: number, data: Uint8Array) {
        await writeUTOCSector(this.factoryInterface, index, data);
    }

    @asyncMutex
    async flushUTOCCacheToDisc() {
        await (await this.exploitStateManager.require(ForceTOCEdit)).forceTOCEdit();
    }

    @asyncMutex
    async runTetris() {
        await (await this.exploitStateManager.require(Tetris)).playTetris();
    }

    @asyncMutex
    async getDeviceFirmware() {
        return getDescriptiveDeviceCode(this.factoryInterface);
    }

    @asyncMutex
    async readRAM(callback: (progress?: { readBytes: number; totalBytes: number }) => void): Promise<Uint8Array> {
        const firmwareVersion = await getDescriptiveDeviceCode(this.factoryInterface);
        const ramSize = firmwareVersion.startsWith('R') ? 0x4800 : 0x9000;
        let readSlices: Uint8Array[] = [];
        for (let i = 0; i < ramSize; i += 0x10) {
            readSlices.push(await cleanRead(this.factoryInterface, i + 0x02000000, 0x10, MemoryType.MAPPED));
            if (callback !== undefined) callback({ readBytes: i, totalBytes: ramSize });
        }

        return concatUint8Arrays(...readSlices);
    }

    @asyncMutex
    async readFirmware(callback: (progress: { type: 'RAM' | 'ROM'; readBytes: number; totalBytes: number }) => void) {
        const firmwareRipper = await this.exploitStateManager.require(FirmwareDumper);
        return await firmwareRipper.readFirmware(callback);
    }

    @asyncMutex
    async exploitDownloadTrack(
        track: number,
        callback: (data: { sectorsRead: number; totalSectors: number; action: 'READ' | 'SEEK'; sector?: string }) => void
    ) {
        const atracDownloader = await this.exploitStateManager.require(CachedSectorAtracDownload);
        return await atracDownloader.downloadTrack(track, callback);
    }
}
