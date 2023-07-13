import { HiMDFullService } from "./original/services/interfaces/himd";
import { Codec, NetMDUSBService, TitleParameter, WireformatDict } from "./original/services/interfaces/netmd";

import { makeGetAsyncPacketIteratorOnWorkerThread } from 'netmd-js/dist/node-encrypt-worker';
import { DiscFormat, MDTrack } from "netmd-js";
import { concatUint8Arrays, sanitizeFullWidthTitle, sanitizeHalfWidthTitle } from "netmd-js/dist/utils";
import path from 'path';
import { Worker } from 'worker_threads';
import { makeAsyncDecryptor } from "himd-js/dist/node-crypto-worker";
import { DevicesIds, dumpTrack, generateCodecInfo, HiMDError, HiMDKBPSToFrameSize, HiMDWriteStream, UMSCHiMDFilesystem, UMSCHiMDSession, uploadMacDependent } from "himd-js";
import { WebUSBDevice, findByIds } from 'usb';

export class EWMDNetMD extends NetMDUSBService {
    override async upload(
        title: string,
        fullWidthTitle: string,
        data: ArrayBuffer,
        _format: Codec,
        progressCallback: (progress: { written: number; encrypted: number; total: number }) => void
    ) {
        let format = _format.codec === "AT3" ? { codec: _format.bitrate === 66 ? 'LP4' : 'LP2' }: _format;
        if (this.currentSession === undefined) {
            throw new Error('Cannot upload without initializing a session first');
        }
        let total = data.byteLength;
        let written = 0;
        let encrypted = 0;
        function updateProgress() {
            progressCallback({ written, encrypted, total });
        }
        const w = new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'netmd-js', 'dist', 'node-encrypt-worker.js')
        );

        let webWorkerAsyncPacketIterator = makeGetAsyncPacketIteratorOnWorkerThread(w, ({ encryptedBytes }) => {
            encrypted = encryptedBytes;
            updateProgress();
        });

        let halfWidthTitle = sanitizeHalfWidthTitle(title);
        fullWidthTitle = sanitizeFullWidthTitle(fullWidthTitle);
        let mdTrack = new MDTrack(halfWidthTitle, WireformatDict[format.codec], data, 0x80000, fullWidthTitle, webWorkerAsyncPacketIterator);

        await this.currentSession.downloadTrack(mdTrack, ({ writtenBytes }) => {
            written = writtenBytes;
            updateProgress();
        });

        w.terminate();
        this.dropCachedContentList();
    }
}

export class EWMDHiMD extends HiMDFullService {
    async download(index: number, progressCallback: (progress: { read: number; total: number; }) => void): Promise<{ format: DiscFormat; data: Uint8Array; } | null> {
        const trackNumber = this.himd!.trackIndexToTrackSlot(index);
        const nodeWorker = await makeAsyncDecryptor(new Worker(
            path.join(__dirname, '..', '..', 'node_modules', 'himd-js', 'dist', 'node-crypto-worker.js')
        ));
        const info = dumpTrack(this.himd!, trackNumber, nodeWorker);
        const blocks: Uint8Array[] = [];
        for await (let { data, total } of info.data) {
            blocks.push(data);
            progressCallback({ read: blocks.length, total });
        }
        return { format: DiscFormat.spStereo, data: concatUint8Arrays(...blocks) };
    }

    async upload(title: TitleParameter, fullWidthTitle: string, data: ArrayBuffer, format: Codec, progressCallback: (progress: { written: number; encrypted: number; total: number; }) => void): Promise<void> {
        debugger;
        if (format.codec === 'MP3') {
            // This will subsequently call HiMDFullService's super
            await super.upload(title, fullWidthTitle, data, format, progressCallback);
        } else {
            if (!this.session) {
                this.session = new UMSCHiMDSession(this.fsDriver!.driver, this.himd!);
                await this.session.performAuthentication();
            }
            const stream = new HiMDWriteStream(
                this.himd!,
                this.atdata!,
                true,
            );
            const titleObject = title as { title?: string | undefined; album?: string | undefined; artist?: string | undefined; };
            let frameSize;
            if (format.codec === "LP2") {
                format = { codec: "AT3", bitrate: 66 };
            } else if (format.codec === "LP4") {
                format = { codec: "AT3", bitrate: 132 };
            }
            switch (format.codec) {
                case 'A3+': frameSize = HiMDKBPSToFrameSize.atrac3plus[format.bitrate!];
                    break;
                case 'AT3': frameSize = HiMDKBPSToFrameSize.atrac3[format.bitrate!];
                    break;
                case 'PCM': frameSize = 0;
                    break;
                default: throw new HiMDError("Invalid format");
            }
            const nodeWorker = await makeAsyncDecryptor(new Worker(
                path.join(__dirname, '..', '..', 'node_modules', 'himd-js', 'dist', 'node-crypto-worker.js')
            ));
    
            const codecInfo = generateCodecInfo(format.codec, frameSize);
            await uploadMacDependent(this.himd!, this.session!, stream, data, codecInfo, titleObject, ({ byte, totalBytes }: { byte: number, totalBytes: number }) => {
                progressCallback({
                    written: byte,
                    encrypted: byte,
                    total: totalBytes,
                });
            }, nodeWorker);
        }
    }

    async pair() {
        let legacyDevice;
        for(let { vendorId, deviceId } of DevicesIds){
            legacyDevice = findByIds(vendorId, deviceId);
            if(legacyDevice) break;
        }
        if(!legacyDevice) return false;

        legacyDevice.open();
        const iface = legacyDevice.interface(0);
        try{
            if(iface.isKernelDriverActive())
                iface.detachKernelDriver();
        }catch(ex){
            console.log("Couldn't detach the kernel driver. Expected on Windows.");
        }
        const webUsbDevice = await WebUSBDevice.createInstance(legacyDevice);
        await webUsbDevice.open();
        this.fsDriver = new UMSCHiMDFilesystem(webUsbDevice);
        return true;
    }
}
