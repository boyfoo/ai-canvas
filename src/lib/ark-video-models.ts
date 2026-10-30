import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import type { ModelChannel } from "@/stores/use-config-store";

export const ARK_VIDEO_PROTOCOL = "volcengine-ark-video";
export const ARK_VIDEO_MODELS = [
    { family: "seedance25", name: "Seedance 2.5", id: "doubao-seedance-2-5-260628", resolutions: ["480p", "720p", "1080p"], max_duration: 30 },
    { family: "seedance20", name: "Seedance 2.0", id: "doubao-seedance-2-0-260128", resolutions: ["480p", "720p", "1080p", "4k"], max_duration: 15 },
    { family: "seedance20fast", name: "Seedance 2.0 Fast", id: "doubao-seedance-2-0-fast-260128", resolutions: ["480p", "720p"], max_duration: 15 },
    { family: "seedance20mini", name: "Seedance 2.0 Mini", id: "doubao-seedance-2-0-mini-260615", resolutions: ["480p", "720p"], max_duration: 15 },
    { family: "seedance10", name: "Seedance 1.0 Pro", id: "doubao-seedance-1-0-pro-250528", resolutions: ["480p", "720p", "1080p"], max_duration: 12 },
    { family: "seedance10fast", name: "Seedance 1.0 Pro Fast", id: "doubao-seedance-1-0-pro-fast-251015", resolutions: ["480p", "720p", "1080p"], max_duration: 12 },
] as const;

export function arkVideoModelProfile(model: string, family?: string): NonNullable<ModelChannel["modelProfiles"]>[number] {
    const definition = family ? ARK_VIDEO_MODELS.find(item => item.family === family) : ARK_VIDEO_MODELS.find(item => item.id === model);
    if (!definition) throw new Error("自定义模型或 Endpoint ID 请选择对应的 Seedance 模型系列");
    const capabilityConfig = defaultModelCapabilityConfig(ARK_VIDEO_PROTOCOL, definition.id);
    const video = capabilityConfig.video!;
    video.resolutions = [...definition.resolutions];
    video.duration = { selection: "range", min: definition.family.startsWith("seedance10") ? 2 : 4, max: definition.max_duration, step: 1, default: 6 };
    video.ratios = [...new Set([...video.ratios, "adaptive"])];
    if (definition.family === "seedance25") video.operations = [...new Set([...video.operations, "extend", "inpaint"])];
    if (definition.family.startsWith("seedance20")) video.operations = [...new Set([...video.operations, "extend"])];
    if (definition.family === "seedance10fast") video.references.maxImages = 1;
    if (definition.family.startsWith("seedance10")) {
        video.references.maxImages = definition.family === "seedance10fast" ? 1 : 2;
        video.references.maxVideos = 0; video.references.maxAudios = 0;
        video.generateAudio = { supported: false, default: false };
        video.operations = ["text_to_video", "image_to_video"];
    }
    return { model, displayName: definition.id === model ? definition.name : undefined, provider_model_family: definition.family, capability: "video", protocol: ARK_VIDEO_PROTOCOL, referenceMediaTransport: { image: "inline", video: "ark-files", audio: "inline" }, capabilityConfig };
}

export function arkVideoModelCatalog(): ChannelModelCatalogItem[] {
    return ARK_VIDEO_MODELS.map(item => ({ id: item.id, displayName: item.name, modelType: "video", supportedEndpointTypes: [ARK_VIDEO_PROTOCOL] }));
}
