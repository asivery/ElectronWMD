import { Disc, Group, Track } from './services/interfaces/netmd';
import { Mutex } from 'async-mutex';

export function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function sleepWithProgressCallback(ms: number, cb: (perc: number) => void) {
    let elapsedSecs = 1;
    let interval = setInterval(() => {
        elapsedSecs++;
        cb(Math.min(100, ((elapsedSecs * 1000) / ms) * 100));
    }, 1000);
    await sleep(ms);
    window.clearInterval(interval);
}

export function debugEnabled() {
    return process.env.NODE_ENV === 'development';
}

export function savePreference(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value));
}

export function loadPreference<T>(key: string, defaultValue: T): T {
    let res = localStorage.getItem(key);
    if (res === null) {
        return defaultValue;
    } else {
        try {
            return JSON.parse(res) as T;
        } catch (e) {
            return defaultValue;
        }
    }
}

export function framesToSec(frames: number) {
    return frames / 512;
}

export function timeToSeekArgs(timeInSecs: number): number[] {
    let value = Math.round(timeInSecs); // ignore frames

    let s = value % 60;
    value = (value - s) / 60; // min

    let m = value % 60;
    value = (value - m) / 60; // hour

    let h = value;

    return [h, m, s, 0];
}

export function secondsToNormal(time: number): string {
    const [h, m, s] = timeToSeekArgs(time);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export type DisplayTrack = {
    index: number;
    title: string;
    fullWidthTitle: string;
    group: string | null;
    duration: number;
    encoding: string;

    album?: string;
    artist?: string;
};

export function getSortedTracks(disc: Disc | null): DisplayTrack[] {
    let tracks: DisplayTrack[] = [];
    if (disc !== null) {
        for (let group of disc.groups) {
            for (let track of group.tracks) {
                tracks.push({
                    index: track.index,
                    title: track.title ?? `Unknown Title`,
                    fullWidthTitle: track.fullWidthTitle ?? ``,
                    group: group.title ?? null,
                    encoding: track.encoding.codec,
                    duration: track.duration,

                    album: track.album,
                    artist: track.artist,
                });
            }
        }
    }
    tracks.sort((l, r) => l.index - r.index);
    return tracks;
}

export function getGroupedTracks(disc: Disc | null) {
    if (!disc) {
        return [];
    }
    let groupedList: Group[] = [];
    let ungroupedTracks = [...(disc.groups.find((n) => n.title === null)?.tracks ?? [])];

    let lastIndex = 0;

    for (let group of disc.groups) {
        if (group.title === null) {
            continue; // Ungrouped tracks
        }
        let toCopy = group.tracks[0].index - lastIndex;
        groupedList.push({
            index: -1,
            title: null,
            fullWidthTitle: null,
            tracks: toCopy === 0 ? [] : ungroupedTracks.splice(0, toCopy),
        });
        lastIndex = group.tracks[group.tracks.length - 1].index + 1;
        groupedList.push(group);
    }
    groupedList.push({
        index: -1,
        title: null,
        fullWidthTitle: null,
        tracks: ungroupedTracks,
    });
    return groupedList;
}

export function recomputeGroupsAfterTrackMove(disc: Disc, trackIndex: number, targetIndex: number) {
    // Used for moving tracks in netmd-mock and deleting
    let offset = trackIndex > targetIndex ? 1 : -1;
    let deleteMode = targetIndex === -1;

    if (deleteMode) {
        offset = -1;
        targetIndex = disc.trackCount;
    }

    let boundsStart = Math.min(trackIndex, targetIndex);
    let boundsEnd = Math.max(trackIndex, targetIndex);

    let allTracks = disc.groups
        .map((n) => n.tracks)
        .reduce((a, b) => a.concat(b), [])
        .sort((a, b) => a.index - b.index)
        .filter((n) => !deleteMode || n.index !== trackIndex);

    let groupBoundaries: {
        name: string | null;
        fullWidthName: string | null;
        start: number;
        end: number;
    }[] = disc.groups
        .filter((n) => n.title !== null)
        .map((group) => ({
            name: group.title,
            fullWidthName: group.fullWidthTitle,
            start: group.tracks[0].index,
            end: group.tracks[0].index + group.tracks.length - 1,
        })); // Convert to a format better for shifting

    let anyChanges = false;

    for (let group of groupBoundaries) {
        if (group.start > boundsStart && group.start <= boundsEnd) {
            group.start += offset;
            anyChanges = true;
        }
        if (group.end >= boundsStart && group.end < boundsEnd) {
            group.end += offset;
            anyChanges = true;
        }
    }

    if (!anyChanges) return disc;

    let newDisc: Disc = { ...disc };

    // Convert back
    newDisc.groups = groupBoundaries
        .map((n) => ({
            title: n.name,
            fullWidthTitle: n.fullWidthName,
            index: n.start,
            tracks: allTracks.slice(n.start, n.end + 1),
        }))
        .filter((n) => n.tracks.length > 0);

    // Convert ungrouped tracks
    let allGrouped = newDisc.groups.map((n) => n.tracks).reduce((a, b) => a.concat(b), []);
    let ungrouped = allTracks.filter((n) => !allGrouped.includes(n));

    // Fix all the track indexes
    if (deleteMode) {
        for (let i = 0; i < allTracks.length; i++) {
            allTracks[i].index = i;
        }
    }

    if (ungrouped.length) newDisc.groups.unshift({ title: null, fullWidthTitle: null, index: 0, tracks: ungrouped });

    return newDisc;
}

export function isSequential(numbers: number[]) {
    if (numbers.length === 0) return true;
    let last = numbers[0];
    for (let num of numbers) {
        if (num === last) {
            ++last;
        } else return false;
    }
    return true;
}

export function asyncMutex(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // This is meant to be used only with classes having a "mutex" instance property
    const oldValue = descriptor.value;
    descriptor.value = async function (...args: any) {
        const mutex = (this as any).mutex as Mutex;
        const release = await mutex.acquire();
        try {
            return await oldValue.apply(this, args);
        } finally {
            release();
        }
    };
    return descriptor;
}

export function getPublicPathFor(path: string){
    return `sandbox://${path}`;
}

declare let process: any;
