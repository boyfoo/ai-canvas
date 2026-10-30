import { describe, expect, it } from "bun:test";
import { channelRequest } from "../src/services/api/channel-request";

describe("浏览器直连模型", () => {
    const config = { baseUrl: "https://models.example/v1", apiKey: "test-key", apiFormat: "openai" as const };

    it("保留服务商地址，不经过工作区中转且不携带 Cookie", () => {
        const request = channelRequest(config, "https://models.example/v1/chat/completions", { "Content-Type": "application/json", "X-Canvas-Upstream-URL": "unused" });
        expect(request.url).toBe("https://models.example/v1/chat/completions");
        expect(request.credentials).toBe("omit");
        expect(request.headers.authorization).toBe("Bearer test-key");
        expect(request.headers["content-type"]).toBe("application/json");
        expect(Object.keys(request.headers).some(name => name.startsWith("x-canvas-"))).toBe(false);
    });

    it("按 Gemini 和 Claude 原生协议发送认证头", () => {
        const gemini = channelRequest({ ...config, apiFormat: "gemini" }, "https://models.example/v1beta/models/test:generateContent", { Authorization: "Bearer old" });
        expect(gemini.headers["x-goog-api-key"]).toBe("test-key");
        expect(gemini.headers.authorization).toBeUndefined();
        const claude = channelRequest({ ...config, apiFormat: "claude" }, "https://models.example/v1/messages");
        expect(claude.headers["x-api-key"]).toBe("test-key");
        expect(claude.headers["anthropic-version"]).toBe("2023-06-01");
        expect(claude.headers.authorization).toBeUndefined();
    });

    it("应用自定义请求头，允许无密钥服务且不干扰 multipart boundary", () => {
        const request = channelRequest({ ...config, apiKey: "", headers: [{ name: "X-Model-Token", value: "custom" }] }, "https://models.example/v1/images/edits");
        expect(request.headers["x-model-token"]).toBe("custom");
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers["content-type"]).toBeUndefined();
    });

    it("拒绝相对中转地址及非 HTTP 协议", () => {
        expect(() => channelRequest({ ...config, baseUrl: "/api/ai/system/test" }, config.baseUrl)).toThrow();
        expect(() => channelRequest(config, "file:///tmp/model")).toThrow();
    });
});
