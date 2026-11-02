import type { ModelCapabilityConfig, VideoCapabilityConfig } from "@/lib/model-capabilities";
import { arkVideoOperations } from "./ark-video-operations";

export const ARK_VIDEO_PROTOCOL = "volcengine-ark-video";
export const ARK_VIDEO_MODELS = [
    { family: "seedance25", name: "Seedance 2.5", id: "doubao-seedance-2-5-260628", resolutions: ["480p", "720p", "1080p"], max_duration: 30 },
    { family: "seedance20", name: "Seedance 2.0", id: "doubao-seedance-2-0-260128", resolutions: ["480p", "720p", "1080p", "4k"], max_duration: 15 },
    { family: "seedance20fast", name: "Seedance 2.0 Fast", id: "doubao-seedance-2-0-fast-260128", resolutions: ["480p", "720p"], max_duration: 15 },
    { family: "seedance20mini", name: "Seedance 2.0 Mini", id: "doubao-seedance-2-0-mini-260615", resolutions: ["480p", "720p"], max_duration: 15 },
    { family: "seedance10", name: "Seedance 1.0 Pro", id: "doubao-seedance-1-0-pro-250528", resolutions: ["480p", "720p", "1080p"], max_duration: 12 },
    { family: "seedance10fast", name: "Seedance 1.0 Pro Fast", id: "doubao-seedance-1-0-pro-fast-251015", resolutions: ["480p", "720p", "1080p"], max_duration: 12 },
] as const;

export function arkVideoModelDefinition(model: string, family?: string) {
    const preset = ARK_VIDEO_MODELS.find((item) => item.id === model);
    if (preset && family && family !== preset.family) throw new Error(`${preset.name} 是预置型号，模型系列固定，不能改为其他系列`);
    const definition = preset || ARK_VIDEO_MODELS.find((item) => item.family === family);
    if (!definition) throw new Error("自定义模型或 Endpoint ID 请选择对应的 Seedance 模型系列");
    return definition;
}

/** 官方视频版能力由提供商维护，不读取用户保存的旧能力快照，不影响原「火山方舟」。 */
export function applyArkVideoCapabilities(capabilities: ModelCapabilityConfig, model: string, family?: string): ModelCapabilityConfig {
    const definition = arkVideoModelDefinition(model, family);
    const video = capabilities.video!;
    const legacy = definition.family.startsWith("seedance10");
    video.resolutions = [...definition.resolutions];
    video.defaultResolution = legacy ? "1080p" : "720p";
    video.duration = { selection: "range", min: legacy ? 2 : 4, max: definition.max_duration, step: 1, default: definition.family === "seedance25" ? -1 : 6, ...(!legacy ? { values: [-1] } : {}) };
    video.ratios = [...new Set([...video.ratios, "adaptive"])];
    video.defaultRatio = legacy ? "16:9" : "adaptive";
    video.taskTypeConstraints = definition.family === "seedance25";
    video.audioOnlyInput = definition.family === "seedance25";
    if (!legacy) {
        const is25 = definition.family === "seedance25";
        video.references = arkVideoReferenceCapabilities(video.references, is25);
    }
    video.operations = arkVideoOperations({ profile: { model, capability: "video", provider_model_family: definition.family }, values: {} }).map((mode) => mode.value);
    video.defaultOperation = "reference_to_video";
    video.operationReferences = {
        reference_to_video: { minImages: 0, ...(legacy ? { maxImages: 0, maxVideos: 0, maxAudios: 0 } : {}) },
        image_to_video: { minImages: 1, maxImages: definition.family === "seedance10fast" ? 1 : 2, maxVideos: 0, maxAudios: 0 },
    };
    if (legacy) {
        video.references.maxImages = definition.family === "seedance10fast" ? 1 : 2;
        video.references.maxVideos = 0;
        video.references.maxAudios = 0;
        video.generateAudio = { supported: false, default: false };
    }
    return capabilities;
}

export function arkVideoReferenceCapabilities(base: VideoCapabilityConfig["references"], is25: boolean): VideoCapabilityConfig["references"] {
    return {
        ...base,
        maxImages: is25 ? 30 : 9,
        maxVideos: is25 ? 10 : 3,
        maxVideoBytes: 200 * 1024 * 1024,
        maxVideoDurationSeconds: is25 ? 30 : 15,
        minVideoDurationSeconds: 2,
        maxVideoTotalDurationSeconds: is25 ? 30 : 15,
        maxAudios: is25 ? 10 : 3,
        maxAudioBytes: 15 * 1024 * 1024,
        maxAudioDurationSeconds: is25 ? 30 : 15,
        minAudioDurationSeconds: 2,
        maxAudioTotalDurationSeconds: is25 ? 30 : 15,
        maxImageBytes: base.maxImageBytes || 30 * 1024 * 1024,
        minImageWidth: 300,
        maxImageWidth: 6000,
        minImageHeight: 300,
        maxImageHeight: 6000,
        minImageAspect: 0.4,
        maxImageAspect: 2.5,
        minVideoWidth: 300,
        maxVideoWidth: 6000,
        minVideoHeight: 300,
        maxVideoHeight: 6000,
        minVideoAspect: 0.4,
        maxVideoAspect: 2.5,
        minVideoPixels: 407696,
        maxVideoPixels: 8295044,
    };
}
