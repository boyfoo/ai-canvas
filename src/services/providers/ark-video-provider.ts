import { arkVideoModelDefinition, ARK_VIDEO_PROTOCOL } from "@/lib/ark-video-models";
import { generationParameterInput, providerRequestParameters, videoGenerationSettings } from "@/lib/generation-parameters";
import { resolveVideoRatioValue } from "@/lib/model-capabilities";
import { resolveVideoOperation, providerVideoOperations } from "@/lib/generation-operations";
import { resolveReferenceMediaDuration } from "@/lib/reference-media-metadata";
import { normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { createChannelTransport } from "@/services/api/channel-transport";
import { assertVideoCapability } from "@/services/api/video-validation";
import { isReferenceHTTPSLink, uploadReferenceLinks, type ReferenceLinkRequest } from "@/services/api/reference-link-replacement";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { buildApiUrl, modelOptionName, resolveModelChannel, type ModelChannel } from "@/stores/use-config-store";
import type { BackendGenerationTaskOptions } from "@/services/api/generation-task";
import type { ReferenceImage } from "@/types/image";
import type { GenerationOperationDefinition } from "@/lib/generation-parameter-types";
import { resolveVideoFrameIds } from "@/lib/video-frame-selection";

export type VideoProviderObservation = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    error?: string;
    error_code?: string;
    video_url?: string;
    last_frame_url?: string;
    mime_type: string;
    duration_ms?: number;
};

export function providerDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("已停止等待", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
}

function sourceUrl(value: string) {
    if (/^asset:\/\/[A-Za-z0-9_-]+$/.test(value)) return value;
    try {
        const url = new URL(value);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname)) return url.href;
    } catch { /* 浏览器本地素材走 Blob 读取。 */ }
    return "";
}

async function dataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException("已停止等待", "AbortError");
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const abort = () => reader.abort();
        const clean = () => signal?.removeEventListener("abort", abort);
        reader.onload = () => { clean(); resolve(String(reader.result)); };
        reader.onerror = () => { clean(); reject(new Error("读取参考素材失败")); };
        reader.onabort = () => { clean(); reject(new DOMException("已停止等待", "AbortError")); };
        signal?.addEventListener("abort", abort, { once: true });
        reader.readAsDataURL(blob);
    });
}

type FileInfo = { id?: string; status?: string; download_url?: string; error?: { message?: string } };

async function uploadArkFile(channel: ModelChannel, blob: Blob, name: string, kind: "image" | "video" | "audio", signal?: AbortSignal, progress?: (label: string, loaded: number, total: number) => void) {
    if (blob.size > (kind === "video" ? 200 : kind === "image" ? 30 : 15) * 1024 * 1024) throw new Error("参考素材超过当前视频模型的文件大小限制");
    if (kind === "video" && (!/\.(mp4|mov)$/i.test(name) || (blob.type && !["video/mp4", "video/quicktime"].includes(blob.type)))) throw new Error("方舟参考视频仅支持 MP4 / MOV");
    const transport = createChannelTransport(channel, "video");
    const form = new FormData();
    form.append("purpose", "user_data"); form.append("file", blob, name);
    const created = await transport.postForm<FileInfo>(buildApiUrl(channel.baseUrl, "/files"), form, { signal, timeout_ms: 180_000, on_upload_progress: (loaded, total) => progress?.(`上传参考素材：${name}`, loaded, total) });
    if (!created.id) throw new Error("方舟上传接口没有返回文件 ID");
    for (let attempt = 0; attempt < 90; attempt += 1) {
        progress?.(`方舟正在处理参考视频：${name}`, blob.size, blob.size);
        const file = await transport.get<FileInfo>(buildApiUrl(channel.baseUrl, `/files/${encodeURIComponent(created.id)}`), { signal, timeout_ms: 20_000, validate_payload: false });
        if (file.status === "failed") throw new Error(file.error?.message || "参考视频处理失败");
        if (file.status === "active") {
            const url = sourceUrl(file.download_url || "");
            if (!url || url.startsWith("asset:")) throw new Error("方舟没有返回有效下载链接，请使用公网视频 URL 或真实 asset ID");
            return url;
        }
        if (file.status !== "processing") throw new Error("方舟返回了未知的文件处理状态");
        await providerDelay(2000, signal);
    }
    throw new Error(`参考视频处理尚未完成（文件 ${created.id}），请稍后重试`);
}

async function referenceSource(media: { name: string; url?: string; dataUrl?: string; storageKey?: string; arkAssetId?: string }, kind: "image" | "video" | "audio", channel: ModelChannel, signal?: AbortSignal, progress?: (label: string, loaded: number, total: number) => void, method = "auto", replacement?: string) {
    if (kind === "image" && media.arkAssetId) return `asset://${media.arkAssetId}`;
    const value = media.url || media.dataUrl || "";
    const remote = sourceUrl(value);
    if (remote) return remote;
    if (replacement && isReferenceHTTPSLink(replacement)) return replacement;
    if (method === "url" || method === "link") throw new Error(`请为参考素材 ${media.name} 提供有效的 HTTPS 链接`);
    let blob = media.storageKey ? await (kind === "image" ? getImageBlob(media.storageKey) : getMediaBlob(media.storageKey)) : null;
    if (!blob && /^(blob:|data:)/.test(value)) {
        const response = await fetch(value, { signal });
        if (!response.ok) throw new Error(`无法读取参考素材：${media.name}`);
        blob = await response.blob();
    }
    if (!blob) throw new Error(`参考素材不可读取：${media.name}，请重新导入素材`);
    if (method === "ark-files" || (method === "auto" && kind === "video")) return uploadArkFile(channel, blob, media.name, kind, signal, progress);
    if (kind === "video") throw new Error("方舟视频参考素材需要 Files API、对象存储或公网链接，请修改视频传输方式");
    if (blob.size > (kind === "image" ? 30 : 15) * 1024 * 1024) throw new Error(`参考${kind === "image" ? "图片" : "音频"}过大`);
    return dataUrl(blob, signal);
}

/** 首尾帧按节点显式选择排序；参考模式保留素材顺序，不能把参考图误发成首帧。 */
function arkImageInputs(images: ReferenceImage[], mode: GenerationOperationDefinition | undefined, metadata: BackendGenerationTaskOptions["metadata"]) {
    const indexed = images.map((image, index) => ({ image, index }));
    if (mode?.referenceMode !== "frames") return indexed.map(item => ({ ...item, role: "reference_image" }));
    const selected = (value: unknown, label: string) => {
        if (!value) return undefined;
        const item = indexed.find(item => item.image.id === value);
        if (!item) throw new Error(`所选${label}图片不可用，请重新选择`);
        return item;
    };
    const frames = resolveVideoFrameIds(indexed.map((item) => item.image.id), metadata, mode.frameCount === 2);
    const first = selected(frames.first, "首帧");
    if (!first) throw new Error("首帧模式需要首帧图片；只指定尾帧时，请补充首帧或取消尾帧指定");
    const tail = selected(frames.last, "尾帧");
    return [{ ...first, role: "first_frame" }, ...(tail ? [{ ...tail, role: "last_frame" }] : [])];
}

export async function prepareArkVideo(options: BackendGenerationTaskOptions, progress?: (label: string, loaded: number, total: number) => void): Promise<Record<string, unknown>> {
    if (options.mode !== "video") throw new Error("火山方舟(视频版)仅支持视频生成");
    const { config, signal } = options;
    const channel = resolveModelChannel(config, config.model);
    if (!channel.apiKey.trim()) throw new Error("请填写方舟 API Key");
    const model = modelOptionName(config.model);
    const profile = channel.modelProfiles?.find(item => item.model === model);
    if (profile?.protocol !== ARK_VIDEO_PROTOCOL) throw new Error("请为视频模型配置对应的模型系列及方舟视频协议");
    const definition = arkVideoModelDefinition(model, profile.provider_model_family);
    const images = options.referenceImages || [];
    const videos = await Promise.all((options.referenceVideos || []).map(resolveReferenceMediaDuration));
    const audios = await Promise.all((options.referenceAudios || []).map(resolveReferenceMediaDuration));
    const operation = resolveVideoOperation({ textCount: 0, imageCount: images.length, videoCount: videos.length, audioCount: audios.length, characterCount: 0 }, options.metadata?.videoEditOperation as string | undefined, config);
    const defaults = config.providerOptions?.[ARK_VIDEO_PROTOCOL] ?? profile.defaultOptions ?? {};
    const supplied = (options.metadata?.providerOptions as Record<string, Record<string, unknown>> | undefined)?.[ARK_VIDEO_PROTOCOL] || {};
    const requested = { ...defaults, ...supplied };
    const draftTaskId = supplied.draft_task_id;
    delete requested.draft_task_id;
    const parameterInput = generationParameterInput(config, profile, { operation: draftTaskId ? "draft_promotion" : operation, references: { imageCount: images.length, videoCount: videos.length, audioCount: audios.length, videoDurationsMs: videos.map(video => video.durationMs || 0) } });
    const extra = providerRequestParameters(channel, profile, requested, parameterInput);
    const { config: effectiveConfig, profile: capabilities, parameters } = videoGenerationSettings({ ...config, providerOptions: { [ARK_VIDEO_PROTOCOL]: extra } }, parameterInput);
    if (draftTaskId) {
        if (definition.family !== "seedance25" || !/^cgt-[A-Za-z0-9_-]+$/.test(String(draftTaskId))) throw new Error("样片转正式需要 Seedance 2.5 和有效的 cgt- 样片任务 ID");
        const original = await createChannelTransport(channel, "video").get<{ model?: string; draft?: boolean; status?: string }>(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(String(draftTaskId))}`), { signal, timeout_ms: 20_000, validate_payload: false });
        if (!original.draft || original.status !== "succeeded" || original.model !== model) throw new Error("请使用同一个模型下已成功完成的样片任务");
        return { model, content: [{ type: "draft_task", draft_task: { id: String(draftTaskId) } }], resolution: "1080p", watermark: config.videoWatermark === "true", ...extra };
    }
    if (!capabilities.operations.includes(operation)) throw new Error("当前模型不支持所选视频生成方式");
    const mode = providerVideoOperations(config)?.find(item => item.value === operation);
    const imageInputs = arkImageInputs(images, mode, options.metadata);
    assertVideoCapability(capabilities, images, videos, audios, effectiveConfig.videoSeconds, { operation });
    const referenceRequests: ReferenceLinkRequest[] = [];
    for (const [kind, media] of [["image", images], ["video", videos], ["audio", audios]] as const) {
        const method = channel.referenceMediaTransport?.[kind];
        if (method !== "url" && method !== "link") continue;
        media.forEach((item, index) => {
            if (sourceUrl(item.url || ("dataUrl" in item ? String(item.dataUrl) : "")) || ("arkAssetId" in item && item.arkAssetId)) return;
            referenceRequests.push({ key: `${kind}:${index}`, label: `${{ image: "图片", video: "视频", audio: "音频" }[kind]} ${index + 1}`, name: item.name, resourceID: resourceIdFromStorageKey(item.storageKey) || undefined, upload: method === "url" });
        });
    }
    const links = referenceRequests.length ? options.resolveReferenceLinks ? await options.resolveReferenceLinks(referenceRequests, signal) : await uploadReferenceLinks(referenceRequests, signal) : {};
    if (!links) throw new DOMException("已取消素材链接配置", "AbortError");
    const resolution = normalizeSeedanceResolution(effectiveConfig.vquality);
    const wireResolution = resolution === "2160p" ? "4k" : resolution;
    if (!capabilities.resolutions.some(value => normalizeSeedanceResolution(value) === resolution)) throw new Error("当前模型不支持所选视频分辨率");
    const content: Record<string, unknown>[] = [];
    const prompt = [mode?.promptPrefix, options.prompt.trim()].filter(Boolean).join("\n");
    if (prompt) content.push({ type: "text", text: prompt });
    for (const { image, index, role } of imageInputs) content.push({ type: "image_url", image_url: { url: await referenceSource(image, "image", channel, signal, progress, channel.referenceMediaTransport?.image, links[`image:${index}`]) }, role });
    for (const [index, video] of videos.entries()) content.push({ type: "video_url", video_url: { url: await referenceSource(video, "video", channel, signal, progress, channel.referenceMediaTransport?.video, links[`video:${index}`]) }, role: "reference_video" });
    for (const [index, audio] of audios.entries()) content.push({ type: "audio_url", audio_url: { url: await referenceSource(audio, "audio", channel, signal, progress, channel.referenceMediaTransport?.audio, links[`audio:${index}`]) }, role: "reference_audio" });
    if (!content.length) throw new Error("请填写提示词或添加参考素材");
    const ratio = resolveVideoRatioValue(capabilities, normalizeSeedanceRatio(effectiveConfig.size));
    const body: Record<string, unknown> = { model, content, resolution: wireResolution, ratio, ...extra };
    if (parameters?.common.some(field => field.key === "videoSeconds" && !field.hidden)) body.duration = Number(effectiveConfig.videoSeconds);
    if (capabilities.watermark.supported) body.watermark = effectiveConfig.videoWatermark === "true";
    if (capabilities.generateAudio.supported) body.generate_audio = effectiveConfig.videoGenerateAudio === "true";
    if (new Blob([JSON.stringify(body)]).size > 64 * 1024 * 1024) throw new Error("视频请求超过 64 MiB，请减少参考素材");
    return body;
}

export const arkVideoProvider = {
    prepare: prepareArkVideo,
    async submit(channel: ModelChannel, body: Record<string, unknown>, signal?: AbortSignal) {
        const task = await createChannelTransport(channel, "video").postJson<{ id?: string }>(buildApiUrl(channel.baseUrl, "/contents/generations/tasks"), body, { signal, timeout_ms: 45_000 });
        if (!task.id) throw new Error("方舟未返回任务 ID，请先在方舟控制台确认提交结果，勿重复生成");
        return task.id;
    },
    async query(channel: ModelChannel, id: string, signal?: AbortSignal): Promise<VideoProviderObservation> {
        const task = await createChannelTransport(channel, "video").get<{ id: string; status: string; error?: { code?: string; message?: string }; content?: { video_url?: string; last_frame_url?: string }; output_format?: "mp4" | "mov"; duration?: number }>(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(id)}`), { signal, timeout_ms: 20_000, validate_payload: false });
        if (task.id !== id) throw new Error("方舟返回的任务 ID 与查询任务不一致");
        const status = task.status === "expired" ? "failed" : task.status;
        if (!["queued", "running", "succeeded", "failed", "cancelled"].includes(status)) throw new Error(`未知方舟任务状态：${task.status}`);
        // 使用查询结果中的实际容器格式；不支持 output_format 的旧型号固定输出 MP4。
        return { id: task.id, status: status as VideoProviderObservation["status"], video_url: task.content?.video_url, last_frame_url: task.content?.last_frame_url, mime_type: task.output_format === "mov" ? "video/quicktime" : "video/mp4", duration_ms: task.duration ? task.duration * 1000 : undefined, error: task.error?.message || (task.status === "expired" ? "方舟任务已过期" : undefined), error_code: task.error?.code };
    },
    cancel(channel: ModelChannel, id: string) {
        return createChannelTransport(channel, "video").delete(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(id)}`), { timeout_ms: 20_000 });
    },
};

export function browserVideoProvider(provider_id?: string) {
    return provider_id === "ark-video" ? arkVideoProvider : undefined;
}
