import type { AiConfig, ChannelHeader } from "@/stores/use-config-store";

type ChannelConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { headers?: ChannelHeader[]; credentialRef?: string };
export type ChannelRequest = { url: string; headers: Record<string, string>; credentials: RequestCredentials };

/** 模型请求直接发送至服务商，不经过工作区 API 或携带工作区 Cookie。 */
export function channelRequest(config: ChannelConfig, upstreamUrl: string, headers: HeadersInit = {}): ChannelRequest {
    requireHttpUrl(config.baseUrl, "当前模型渠道 Base URL");
    const url = requireHttpUrl(upstreamUrl, "当前模型请求地址");
    const requestHeaders = new Headers(headers);
    for (const name of [...requestHeaders.keys()]) {
        if (/^x-canvas-/i.test(name)) requestHeaders.delete(name);
    }
    requestHeaders.delete("Authorization");
    requestHeaders.delete("x-goog-api-key");
    requestHeaders.delete("x-api-key");
    if (config.apiKey.trim()) {
        if (config.apiFormat === "gemini") requestHeaders.set("x-goog-api-key", config.apiKey);
        else if (config.apiFormat === "claude") requestHeaders.set("x-api-key", config.apiKey);
        else requestHeaders.set("Authorization", `Bearer ${config.apiKey}`);
    }
    if (config.apiFormat === "claude") {
        requestHeaders.set("anthropic-version", "2023-06-01");
        requestHeaders.set("anthropic-dangerous-direct-browser-access", "true");
    }
    for (const header of config.headers || []) {
        if (header.name.trim()) requestHeaders.set(header.name.trim(), header.value);
    }
    return { url, headers: Object.fromEntries(requestHeaders.entries()), credentials: "omit" };
}

function requireHttpUrl(value: string, label: string) {
    let parsed: URL;
    try { parsed = new URL(value.trim()); }
    catch { throw new Error(`${label} 无效，请填写模型服务的完整 HTTP 地址`); }
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label} 无效，请填写模型服务的完整 HTTP 地址`);
    return parsed.toString();
}
