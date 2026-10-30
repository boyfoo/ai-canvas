import { modelCatalogRequestURL, servicePresetFor } from "@/lib/model-service-presets";
import { channelRequest } from "@/services/api/channel-request";
import { buildApiUrl, type ModelChannel } from "@/stores/use-config-store";

export type DirectTestRequest = { url: string; method: "GET" | "POST"; body: string };
export type DirectTestResult = {
    outcome: "response" | "network_error" | "timeout" | "cancelled";
    request_url: string;
    method: DirectTestRequest["method"];
    duration_ms: number;
    http_status?: number;
    content_type?: string;
    body_excerpt?: string;
    truncated?: boolean;
};

export function defaultModelDirectTestRequest(channel: ModelChannel): DirectTestRequest {
    return {
        url: ["ark", "ark-video"].includes(servicePresetFor(channel)) ? buildApiUrl(channel.baseUrl, "/contents/generations/tasks") : modelCatalogRequestURL(channel),
        method: "GET",
        body: "{}",
    };
}

/** 仅验证本次地址、方法与响应可读性，不创建工作区任务，也不把 HTTP 成功当作生成成功。 */
export async function testModelDirectConnection(channel: ModelChannel, input: DirectTestRequest, options: { signal?: AbortSignal; timeout_ms?: number; fetch_impl?: typeof fetch } = {}): Promise<DirectTestResult> {
    let target: URL;
    let base: URL;
    try { target = new URL(input.url.trim()); base = new URL(channel.baseUrl.trim()); }
    catch { throw new Error("请先填写有效的服务地址和完整的测试请求地址"); }
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.hash) throw new Error("请填写不含账号或片段的完整 HTTP(S) 请求地址");
    if (target.origin !== base.origin) throw new Error("测试地址必须与当前模型服务同源；更换服务时请先修改服务地址");
    if (input.method === "POST") {
        try { JSON.parse(input.body); }
        catch { throw new Error("请求体不是有效的 JSON，请修改后再发送"); }
    }
    const request = channelRequest(channel, target.href, { Accept: "application/json", ...(input.method === "POST" ? { "Content-Type": "application/json" } : {}) });
    const started = performance.now();
    const result = (outcome: DirectTestResult["outcome"], extra: Partial<DirectTestResult> = {}): DirectTestResult => ({
        outcome, request_url: request.url, method: input.method, duration_ms: Math.round(performance.now() - started), ...extra,
    });
    if (options.signal?.aborted) return result("cancelled");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeout_ms ?? 20_000);
    let response: Response | undefined;
    try {
        response = await (options.fetch_impl ?? fetch)(request.url, {
            method: input.method,
            headers: request.headers,
            ...(input.method === "POST" ? { body: input.body } : {}),
            credentials: "omit",
            mode: "cors",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
        });
        const preview = await readResponsePreview(response);
        const secrets = [channel.apiKey, channel.secretKey, ...(channel.headers || []).filter(header => /authorization|api[-_]?key|token|secret/i.test(header.name)).map(header => header.value)];
        let text = preview.text;
        for (const secret of secrets) if (secret) text = text.split(secret).join("[已隐藏凭证]");
        return result("response", { http_status: response.status, content_type: response.headers.get("content-type") || "", body_excerpt: text, truncated: preview.truncated });
    } catch {
        // Fetch 不向页面暴露被 CORS 拦截的 HTTP 状态，不能据此区分跨域、DNS、TLS 或断网。
        return result(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network_error", { http_status: response?.status });
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
    }
}

async function readResponsePreview(response: Response) {
    const contentType = response.headers.get("content-type") || "";
    if (/^(?:image|audio|video)\//i.test(contentType)) {
        await response.body?.cancel();
        return { text: `已收到二进制响应（${contentType}）`, truncated: false };
    }
    if (!response.body) return { text: "", truncated: false };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const limit = 16 * 1024;
    let bytes = 0;
    let text = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) return { text: text + decoder.decode(), truncated: false };
            const remaining = limit - bytes;
            text += decoder.decode(value.subarray(0, remaining), { stream: true });
            bytes += value.byteLength;
            if (bytes > limit) {
                await reader.cancel();
                return { text: text + decoder.decode(), truncated: true };
            }
        }
    } finally { reader.releaseLock(); }
}
