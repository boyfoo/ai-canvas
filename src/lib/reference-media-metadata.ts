import { probeMediaMetadata, probeMediaUrlMetadata, type MediaMetadata } from "@/lib/media-metadata";
import { getActiveUserScope } from "@/lib/user-scope";
import { getMediaBlob } from "@/services/file-storage";
import { getResource, ownedResourceIdFromMediaRef, resourceStorageKey } from "@/services/api/resources";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

const pending = new Map<string, Promise<MediaMetadata | undefined>>();
const METADATA_TIMEOUT_MS = 12_000;

type ReferenceMetadataSource =
    | { kind: "resource"; resourceId: string; storageKey: string }
    | { kind: "local_file"; storageKey: string }
    | { kind: "inline_url"; url: string }
    | { kind: "remote_url"; url: string }
    | { kind: "provider_asset"; url: string };

/** 来源决定读取方式；媒体 MIME 决定使用 video 还是 audio，不能用画布节点的显示尺寸代替原片尺寸。 */
function referenceMetadataSource(media: ReferenceAudio | ReferenceVideo): ReferenceMetadataSource | undefined {
    const resourceId = ownedResourceIdFromMediaRef(media.storageKey, media.url);
    if (resourceId) return { kind: "resource", resourceId, storageKey: resourceStorageKey(resourceId) };
    if (media.storageKey) return { kind: "local_file", storageKey: media.storageKey };
    if (/^asset:\/\/[A-Za-z0-9_-]+$/.test(media.url)) return { kind: "provider_asset", url: media.url };
    if (/^(blob:|data:)/i.test(media.url)) return { kind: "inline_url", url: media.url };
    if (/^https?:\/\//i.test(media.url)) return { kind: "remote_url", url: media.url };
}

/** 按来源读取真实元数据；普通生成、重试和各提供商共用，不要求先播放或先下载。 */
export async function resolveReferenceMediaDuration<T extends ReferenceAudio | ReferenceVideo>(media: T): Promise<T> {
    if (Number.isFinite(media.durationMs) && (media.durationMs || 0) > 0 && (!media.type.startsWith("video/") || ((media as ReferenceVideo).width && (media as ReferenceVideo).height))) return media;
    const source = referenceMetadataSource(media);
    // asset:// 是服务商的非透明素材引用，浏览器不能把它当作可读取的网络文件。
    if (!source || source.kind === "provider_asset") return media;
    const key = JSON.stringify([getActiveUserScope(), source.kind, "storageKey" in source ? source.storageKey : source.url, media.type]);
    let task = pending.get(key);
    if (!task) {
        task = readDuration(media, source).finally(() => pending.delete(key));
        pending.set(key, task);
    }
    const metadata = await task;
    return metadata ? { ...media, ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => Number.isFinite(value) && Number(value) > 0)) } : media;
}

async function readDuration(media: ReferenceAudio | ReferenceVideo, source: ReferenceMetadataSource) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                // blob/data 与公网 URL 都可由原生媒体元素读取；不 fetch 或转换成另一份文件。
                if (source.kind === "inline_url" || source.kind === "remote_url") return probeMediaUrlMetadata(source.url, media.type, controller.signal);
                if (source.kind === "provider_asset") return undefined;
                if (source.kind === "resource") {
                    try {
                        const resource = await getResource(source.resourceId, { params: { metadata: "ensure" }, signal: controller.signal, timeout: 10_000 });
                        if (Number.isFinite(resource.durationMs) && (resource.durationMs || 0) > 0 && (!media.type.startsWith("video/") || (resource.width && resource.height))) return { durationMs: resource.durationMs, width: resource.width, height: resource.height };
                    } catch {
                        // Runtimes without a usable native probe retain the bounded browser path.
                        if (controller.signal.aborted) return undefined;
                    }
                }
                if (controller.signal.aborted) return undefined;
                // 已有本地文件或所属资源沿用原存储读取，不重新上传、不改写 URL 身份。
                const blob = await getMediaBlob(source.storageKey);
                if (!blob || controller.signal.aborted) return undefined;
                const file = new File([blob], media.name, { type: /^audio\/|^video\//.test(blob.type) ? blob.type : media.type });
                return probeMediaMetadata(file, controller.signal);
            })(),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => {
                    controller.abort();
                    resolve(undefined);
                }, METADATA_TIMEOUT_MS);
            }),
        ]);
    } catch {
        // Existing duration validation reports unknown metadata; transport errors must not invent a duration.
        return undefined;
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
