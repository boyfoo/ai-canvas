import { http } from "@/services/api/request";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";
import { hasCanvasBackend } from "@/lib/canvas-host-config";

type PluginProviderCatalogItem = {
    id: string;
    version: string;
    name: string;
    vendor: string;
    categories: string[];
    scopes: string[];
    create?: string;
    poll?: string;
    contentType?: string;
    enabled: boolean;
    unavailableReason?: string;
    baseUrl?: string;
    authType?: string;
    workflows?: Array<{
        id: string;
        label: string;
        providerId: string;
        capability: ProtocolCapability;
        parameters: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>;
        defaults?: Record<string, string | number | boolean>;
    }>;
};

export async function fetchPluginProviderCatalog(scope: string, capability?: ProtocolCapability) {
    if (scope === "user.custom-channel" || !hasCanvasBackend()) return BUILTIN_PROTOCOLS.filter((item) => !capability || item.capability === capability);
    const result = await http.get<{ providers: PluginProviderCatalogItem[] }>("/plugins/catalog", { params: { scope, capability } });
    return result.providers.filter((item) => item.enabled && !item.unavailableReason).map(toProviderDefinition);
}

const BUILTIN_PROTOCOLS: ModelProtocolDefinition[] = [
    { value: "volcengine-ark-video", label: "火山方舟视频", vendor: "Volcengine", capability: "video", create: "POST /api/v3/contents/generations/tasks", poll: "GET /api/v3/contents/generations/tasks/{task_id}", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "chat-completion", label: "OpenAI Chat Completions", vendor: "OpenAI", capability: "text", create: "POST /v1/chat/completions", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "openai-response", label: "OpenAI Responses", vendor: "OpenAI", capability: "text", create: "POST /v1/responses", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "openai-image", label: "OpenAI Images", vendor: "OpenAI", capability: "image", create: "POST /v1/images/generations", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "claude-api", label: "Claude Messages", vendor: "Anthropic", capability: "text", create: "POST /v1/messages", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "gemini-generate-content", label: "Gemini Generate Content", vendor: "Google", capability: "text", create: "POST /v1beta/models/{model}:generateContent", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "gemini-image", label: "Gemini Images", vendor: "Google", capability: "image", create: "POST /v1beta/models/{model}:generateContent", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "openai-audio", label: "OpenAI Speech", vendor: "OpenAI", capability: "audio", create: "POST /v1/audio/speech", contentType: "application/json", media: "内置协议", enabled: true },
    { value: "newapi", label: "OpenAI Videos", vendor: "OpenAI compatible", capability: "video", create: "POST /v1/videos", poll: "GET /v1/videos/{task_id}", contentType: "multipart/form-data", media: "内置协议", enabled: true },
];

function toProviderDefinition(item: PluginProviderCatalogItem): ModelProtocolDefinition {
    return {
        value: item.id,
        label: item.name,
        vendor: item.vendor,
        capability: (item.categories[0] || "text") as ProtocolCapability,
        create: item.create || "",
        poll: item.poll,
        contentType: item.contentType || "application/json",
        media: `${item.vendor} · ${item.version}`,
        enabled: item.enabled && !item.unavailableReason,
        baseUrl: item.baseUrl,
        authType: item.authType,
        workflows: item.workflows || [],
    };
}
