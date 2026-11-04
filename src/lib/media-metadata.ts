// 媒体元数据：通过原生 <video>/<audio> 读取真实时长（毫秒）及视频尺寸。
// 结果随上传 meta 传给后端，供资源摘要和时间线片段使用；这里不负责验证完整播放能力。

const PROBE_TIMEOUT_MS = 8000;

function isProbeable(file: File): boolean {
    return /^video\//.test(file.type) || /^audio\//.test(file.type);
}

/**
 * 返回可确认的媒体时长；非音视频、浏览器不支持解码、元数据错误或超时都返回 undefined。
 * 这是上传附加信息而不是写入前置条件，调用方必须允许缺少时长，但不能编造默认时长。
 */
export async function probeMediaDurationMs(file: File): Promise<number | undefined> {
    return (await probeMediaMetadata(file))?.durationMs;
}

export type MediaMetadata = { durationMs?: number; width?: number; height?: number };

/** 播放器和提交准备共用真实媒体数据；未知值不写入，不能用生成参数推算。 */
export function readMediaElementMetadata(el: HTMLMediaElement): MediaMetadata {
    const metadata: MediaMetadata = {};
    const durationMs = Math.round(el.duration * 1000);
    if (Number.isFinite(durationMs) && durationMs > 0) metadata.durationMs = durationMs;
    if ("videoWidth" in el && typeof el.videoWidth === "number" && Number.isFinite(el.videoWidth) && el.videoWidth > 0) metadata.width = el.videoWidth;
    if ("videoHeight" in el && typeof el.videoHeight === "number" && Number.isFinite(el.videoHeight) && el.videoHeight > 0) metadata.height = el.videoHeight;
    return metadata;
}

export async function probeMediaMetadata(file: File, signal?: AbortSignal): Promise<MediaMetadata | undefined> {
    if (!isProbeable(file)) return undefined;
    const url = URL.createObjectURL(file);
    try {
        return await probeMediaUrlMetadata(url, file.type, signal);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** URL 只由原生媒体元素加载元数据；不设置 crossOrigin、不 fetch/转 Blob、不抽帧或落盘。 */
export async function probeMediaUrlMetadata(url: string, mimeType: string, signal?: AbortSignal): Promise<MediaMetadata | undefined> {
    if (!/^(video|audio)\//.test(mimeType) || signal?.aborted) return undefined;
    const el: HTMLVideoElement | HTMLAudioElement = /^video\//.test(mimeType)
        ? document.createElement("video")
        : document.createElement("audio");
    let timeoutId: number | undefined;
    let abort = () => {};
    el.preload = "metadata";
    // 某些浏览器只有在静音时才允许视频元素主动加载元数据；这里只禁止声音，不触发自动播放。
    el.muted = true;
    try {
        const metadata = await new Promise<MediaMetadata | undefined>((resolve) => {
            abort = () => resolve(undefined);
            timeoutId = window.setTimeout(abort, PROBE_TIMEOUT_MS);
            el.onloadedmetadata = () => resolve(readMediaElementMetadata(el));
            el.onerror = abort;
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
            else el.src = url;
        });
        return metadata;
    } catch {
        return undefined;
    } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abort);
        el.onloadedmetadata = null;
        el.onerror = null;
        el.pause();
        el.removeAttribute("src");
        el.load();
    }
}
