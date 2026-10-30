import { ARK_VIDEO_MODELS, ARK_VIDEO_PROTOCOL } from "@/lib/ark-video-models";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resolveVideoOperation } from "@/lib/model-selection";
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

export type VideoProviderObservation = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    error?: string;
    error_code?: string;
    video_url?: string;
    last_frame_url?: string;
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

export async function prepareArkVideo(options: BackendGenerationTaskOptions, progress?: (label: string, loaded: number, total: number) => void): Promise<Record<string, unknown>> {
    if (options.mode !== "video") throw new Error("火山方舟(视频版)仅支持视频生成");
    const { config, signal } = options;
    const channel = resolveModelChannel(config, config.model);
    if (!channel.apiKey.trim()) throw new Error("请填写方舟 API Key");
    const model = modelOptionName(config.model);
    const profile = channel.modelProfiles?.find(item => item.model === model);
    const definition = ARK_VIDEO_MODELS.find(item => item.family === profile?.provider_model_family);
    if (!definition || profile?.protocol !== ARK_VIDEO_PROTOCOL) throw new Error("请为视频模型配置对应的模型系列及方舟视频协议");
    const images = options.referenceImages || [];
    const videos = await Promise.all((options.referenceVideos || []).map(resolveReferenceMediaDuration));
    const audios = await Promise.all((options.referenceAudios || []).map(resolveReferenceMediaDuration));
    const operation = resolveVideoOperation({ textCount: 0, imageCount: images.length, videoCount: videos.length, audioCount: audios.length, characterCount: 0 }, options.metadata?.videoEditOperation as string | undefined);
    const capabilities = modelCapabilityConfigFor(config, config.model).video!;
    if (!capabilities.operations.includes(operation)) throw new Error("当前模型不支持所选视频生成方式");
    const defaults = profile.defaultOptions || {};
    const supplied = (options.metadata?.providerOptions as Record<string, Record<string, unknown>> | undefined)?.[ARK_VIDEO_PROTOCOL] || {};
    const extra = { ...defaults, ...supplied };
    for (const [key, min, max] of [["priority", 0, 9], ["execution_expires_after", 3600, 259200], ["seed", -1, 2147483647]] as const) {
        if (extra[key] !== undefined && (!Number.isInteger(extra[key]) || Number(extra[key]) < min || Number(extra[key]) > max)) throw new Error(`${key} 需为 ${min}–${max} 之间的整数`);
    }
    for (const key of ["return_last_frame", "draft", "camera_fixed"]) if (extra[key] !== undefined && typeof extra[key] !== "boolean") throw new Error(`${key} 必须为布尔值`);
    if (extra.safety_identifier !== undefined && !/^[\x21-\x7E]{1,64}$/.test(String(extra.safety_identifier))) throw new Error("安全标识需为 1–64 位无空格的 ASCII 字符");
    if (extra.output_format !== undefined && !["mp4", "mov"].includes(String(extra.output_format))) throw new Error("视频输出格式仅支持 MP4 / MOV");
    if (extra.service_tier !== undefined && !["default", "flex"].includes(String(extra.service_tier))) throw new Error("服务等级仅支持 default / flex");
    if (extra.service_tier === "flex" && extra.priority !== undefined) throw new Error("离线推理不支持设置优先级");
    if (extra.tools !== undefined && (!Array.isArray(extra.tools) || !extra.tools.length || extra.tools.some(tool => !tool || typeof tool !== "object" || tool.type !== "web_search"))) throw new Error("视频工具仅支持 web_search");
    if (extra.draft_task_id) {
        if (definition.family !== "seedance25" || !/^cgt-[A-Za-z0-9_-]+$/.test(String(extra.draft_task_id))) throw new Error("样片转正式需要 Seedance 2.5 和有效的 cgt- 样片任务 ID");
        const original = await createChannelTransport(channel, "video").get<{ model?: string; draft?: boolean; status?: string }>(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(String(extra.draft_task_id))}`), { signal, timeout_ms: 20_000, validate_payload: false });
        if (!original.draft || original.status !== "succeeded" || original.model !== model) throw new Error("请使用同一个模型下已成功完成的样片任务");
        return { model, content: [{ type: "draft_task", draft_task: { id: String(extra.draft_task_id) } }], resolution: "1080p", watermark: config.videoWatermark === "true", return_last_frame: extra.return_last_frame === true, ...(extra.output_format ? { output_format: extra.output_format } : {}) };
    }
    assertVideoCapability(capabilities, images, videos, audios, config.videoSeconds, { operation });
    const referenceRequests: ReferenceLinkRequest[] = [];
    for (const [kind, media] of [["image", images], ["video", videos], ["audio", audios]] as const) {
        const method = profile.referenceMediaTransport?.[kind];
        if (method !== "url" && method !== "link") continue;
        media.forEach((item, index) => {
            if (sourceUrl(item.url || ("dataUrl" in item ? String(item.dataUrl) : "")) || ("arkAssetId" in item && item.arkAssetId)) return;
            referenceRequests.push({ key: `${kind}:${index}`, label: `${{ image: "图片", video: "视频", audio: "音频" }[kind]} ${index + 1}`, name: item.name, resourceID: resourceIdFromStorageKey(item.storageKey) || undefined, upload: method === "url" });
        });
    }
    const links = referenceRequests.length ? options.resolveReferenceLinks ? await options.resolveReferenceLinks(referenceRequests, signal) : await uploadReferenceLinks(referenceRequests, signal) : {};
    if (!links) throw new DOMException("已取消素材链接配置", "AbortError");
    const resolution = normalizeSeedanceResolution(config.vquality);
    const wireResolution = resolution === "2160p" ? "4k" : resolution;
    if (!capabilities.resolutions.some(value => normalizeSeedanceResolution(value) === resolution)) throw new Error("当前模型不支持所选视频分辨率");
    const content: Record<string, unknown>[] = [];
    if (options.prompt.trim()) content.push({ type: "text", text: options.prompt.trim() });
    const firstLast = operation === "image_to_video";
    if (firstLast && images.length > 2) throw new Error("首尾帧模式最多使用两张图片；更多图片请选择全模态参考");
    if (extra.camera_fixed && images.length) throw new Error("固定镜头仅支持文生视频，请关闭固定镜头后使用参考图片");
    if (definition.family.startsWith("seedance10") && extra.tools) throw new Error("当前模型不支持联网搜索");
    for (const [index, image] of images.entries()) content.push({ type: "image_url", image_url: { url: await referenceSource(image, "image", channel, signal, progress, profile.referenceMediaTransport?.image, links[`image:${index}`]) }, role: firstLast ? index === 0 ? "first_frame" : "last_frame" : "reference_image" });
    for (const [index, video] of videos.entries()) content.push({ type: "video_url", video_url: { url: await referenceSource(video, "video", channel, signal, progress, profile.referenceMediaTransport?.video, links[`video:${index}`]) }, role: "reference_video" });
    for (const [index, audio] of audios.entries()) content.push({ type: "audio_url", audio_url: { url: await referenceSource(audio, "audio", channel, signal, progress, profile.referenceMediaTransport?.audio, links[`audio:${index}`]) }, role: "reference_audio" });
    if (!content.length) throw new Error("请填写提示词或添加参考素材");
    const ratio = definition.family === "seedance25" && ["image_to_video", "extend", "inpaint"].includes(operation) ? "adaptive" : normalizeSeedanceRatio(config.size);
    const body: Record<string, unknown> = { model, content, resolution: wireResolution, ratio, duration: operation === "inpaint" ? -1 : Number(config.videoSeconds), watermark: config.videoWatermark === "true" };
    if (capabilities.generateAudio.supported) body.generate_audio = config.videoGenerateAudio === "true";
    if (definition.family === "seedance25" && ["extend", "inpaint"].includes(operation)) body.omni_reference_task_type = operation === "extend" ? "extend" : "edit";
    for (const key of ["return_last_frame", "seed", "camera_fixed", "service_tier", "priority", "execution_expires_after", "safety_identifier", "draft", "output_format", "tools"]) if (extra[key] !== undefined) body[key] = extra[key];
    if (body.draft && definition.family !== "seedance25") throw new Error("当前模型不支持样片模式");
    if (body.draft) body.resolution = "480p";
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
        const task = await createChannelTransport(channel, "video").get<{ id: string; status: string; error?: { code?: string; message?: string }; content?: { video_url?: string; last_frame_url?: string }; duration?: number }>(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(id)}`), { signal, timeout_ms: 20_000, validate_payload: false });
        if (task.id !== id) throw new Error("方舟返回的任务 ID 与查询任务不一致");
        const status = task.status === "expired" ? "failed" : task.status;
        if (!["queued", "running", "succeeded", "failed", "cancelled"].includes(status)) throw new Error(`未知方舟任务状态：${task.status}`);
        return { id: task.id, status: status as VideoProviderObservation["status"], video_url: task.content?.video_url, last_frame_url: task.content?.last_frame_url, duration_ms: task.duration ? task.duration * 1000 : undefined, error: task.error?.message || (task.status === "expired" ? "方舟任务已过期" : undefined), error_code: task.error?.code };
    },
    cancel(channel: ModelChannel, id: string) {
        return createChannelTransport(channel, "video").delete(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${encodeURIComponent(id)}`), { timeout_ms: 20_000 });
    },
};

export function browserVideoProvider(provider_id?: string) {
    return provider_id === "ark-video" ? arkVideoProvider : undefined;
}
