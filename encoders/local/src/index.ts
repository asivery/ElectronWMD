import { type CustomParameters, type CustomParameterInfo, type AudioEncoderV1API, type AudioEncoderV1ExportParams, type AudioEncoderV1Instance, type AudioEncoderV1ExportCodec, type PublicFfmpegAudioEncoderV1 } from "./external/external-interface";

export default class LocalAtracExportService implements AudioEncoderV1Instance {
    static customConstructionParameters: CustomParameterInfo[] = [
        {
            userFriendlyName: 'psp_at3tool Path',
            type: 'hostFilePath',
            varName: 'exe',
            defaultValue: '',
            validator: (content: string) => !!content,
        },
    ];

    public exe: string;
    public ffmpeg: string;

    private ffmpegApi: PublicFfmpegAudioEncoderV1;

    constructor(private api: AudioEncoderV1API, parameters: CustomParameters) {
        this.ffmpeg = parameters.ffmpeg as string;
        this.exe = parameters.exe as string;

        this.ffmpegApi = api.getBuiltinEncoder('ffmpeg');
    }

    async init(): Promise<void> {
        await this.ffmpegApi.init();
    }

    async deinit(): Promise<void> {
        await this.ffmpegApi.deinit();
    }

    async transcode(source: Uint8Array<ArrayBuffer>, sourceFileName: string, exportParams: AudioEncoderV1ExportParams, transcodeCallback?: (obj: { stage: string; progress: number; total: number; }) => void): Promise<Uint8Array<ArrayBuffer>> {
        if(['PCM', 'MP3'].includes(exportParams.format.codec)) {
            return this.ffmpegApi.transcode(source, sourceFileName, exportParams, transcodeCallback);
        }

        const ffmpegCommand = this.ffmpegApi.createFfmpegParams(exportParams, 'wav');

        const dotIndex = sourceFileName.lastIndexOf('.') + 1;
        const fileExtension = dotIndex > 0 ? sourceFileName.substring(dotIndex) : 'unknown';
        const inFileName = `inAudioFile.${fileExtension}`;

        transcodeCallback?.({ stage: 'ffmpeg', progress: 0, total: 1 });

        await this.ffmpegApi.ffmpegProcess.write(inFileName, source);
        await this.ffmpegApi.ffmpegProcess.transcode(inFileName, 'outAudioFile.wav', ffmpegCommand);
        const { data } = await this.ffmpegApi.ffmpegProcess.read('outAudioFile.wav');

        const response = await (window as any).native!.invokeLocalEncoder!(this.exe, data.buffer, 'intermediate.wav', exportParams);
        if (!response) throw new Error("Couldn't invoke the local encoder!");

        const content = new Uint8Array(response);
        const headerLength = (this.api.getATRACWAVEncoding(content))!.headerLength;
        await this.ffmpegApi.ffmpegProcess.remove('outAudioFile.wav');
        return content.slice(headerLength);
    }

    getSupportFor(_codec: AudioEncoderV1ExportCodec) {
        return { state: 'perfect' as const, gapless: false };
    }

    getUserFriendyStageName(stage: string): string | null {
        return {
            transcoding: 'Transcoding...',
        }[stage] ?? this.ffmpegApi.getUserFriendyStageName(stage);
    }
}
