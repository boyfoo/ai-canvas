import { sanitizeChannelModelCatalogItem, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { createChannelTransport } from "@/services/api/channel-transport";
import { readAxiosError, validateGeminiPayload } from "@/services/api/image-response";
import { geminiApiUrl, geminiHeaders } from "@/services/api/image-transport";


import { buildApiUrl, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};

type GeminiModelPayload = { models?: Array<{ name?: string }> };
type OpenAIModelRecord = {
    id?: string;
    name?: string;
    display_name?: string;
    model_type?: string;
    supported_endpoint_types?: string[];
    video_capabilities?: unknown;
    image_capabilities?: unknown;
    image_capabilities_version?: string;
    video_capabilities_version?: string;
    video_pricing?: unknown;
    media_capabilities?: unknown;
    media_capabilities_version?: string;
};
type OpenAIModelPayload = { data?: OpenAIModelRecord[]; error?: { message?: string } };

async function fetchOpenAIModelCatalog(config: Pick<ModelChannel, "baseUrl" | "apiKey" | "apiFormat" | "headers" | "credentialRef">, signal?: AbortSignal) {
    const payload = await createChannelTransport(config, "image").get<OpenAIModelPayload>(buildApiUrl(config.baseUrl, "/models"), { signal });
    return (payload.data || [])
        .map((model) =>
            sanitizeChannelModelCatalogItem({
                id: model.id || model.name,
                displayName: model.display_name || model.name,
                modelType: model.model_type,
                supportedEndpointTypes: model.supported_endpoint_types,
                imageCapabilities: model.image_capabilities,
                imageCapabilitiesVersion: model.image_capabilities_version,
                videoCapabilities: model.video_capabilities,
                videoCapabilitiesVersion: model.video_capabilities_version,
                videoPricing: model.video_pricing,
                mediaCapabilities: model.media_capabilities,
                mediaCapabilitiesVersion: model.media_capabilities_version,
            }),
        )
        .filter((item): item is ChannelModelCatalogItem => Boolean(item));
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const requestConfig = { ...defaultGeminiConfig, ...config };
            const payload = await createChannelTransport(requestConfig, "image").get<GeminiModelPayload>(geminiApiUrl(requestConfig), { headers: geminiHeaders(requestConfig) });
            validateGeminiPayload(payload);
            return (payload.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const catalog = await fetchOpenAIModelCatalog(config);
        return catalog.map((model) => model.id).sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export type ChannelModelFetchResult = { models: string[]; catalog: ChannelModelCatalogItem[] };

export async function fetchChannelModels(channel: ModelChannel, signal?: AbortSignal): Promise<ChannelModelFetchResult> {
    if (channel.apiFormat === "gemini") {
        const payload = await createChannelTransport(channel, "image").get<GeminiModelPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...channel }), { signal, headers: geminiHeaders(channel) });
        validateGeminiPayload(payload);
        const models = (payload.models || []).map(model => model.name?.replace(/^models\//, "")).filter((id): id is string => Boolean(id)).sort();
        return { models, catalog: models.map(id => ({ id })) };
    }
    const catalog = await fetchOpenAIModelCatalog(channel, signal);
    return { models: catalog.map(item => item.id).sort(), catalog };
}