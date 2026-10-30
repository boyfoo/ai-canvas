import { afterAll, describe, expect, it } from "bun:test";
import { apiClient, apiBaseURL, ApiError } from "../src/services/api/request";
import { bootstrapCanvasHost, getCanvasHostServices } from "../src/services/canvas-host";
import { usesServiceResourceRuntime } from "../src/lib/canvas-host-config";
import { uploadReferenceLinks } from "../src/services/api/reference-link-replacement";

const originalWindow = globalThis.window;
const originalAdapter = apiClient.defaults.adapter;
const calls: Array<{ url?: string; method?: string; data?: unknown; signal?: unknown }> = [];
let uploadFailure = false;
let uploadCount = 0;
let activeUploads = 0;
let maxUploads = 0;

globalThis.window = { location: { origin: "https://canvas.example" }, __CANVAS_CONFIG__: { apiBaseURL: "/api", resourceStorage: "service" } } as unknown as Window & typeof globalThis;

apiClient.defaults.adapter = async (config) => {
    calls.push({ url: config.url, method: config.method, data: config.data ? JSON.parse(config.data) : undefined, signal: config.signal });
    let data: unknown = {};
    if (config.url?.endsWith("/reference-storage")) data = { enabled: true, endpoint: "", bucket: "", region: "auto", accessKeyId: "", publicBaseURL: "", hasSecret: false };
    if (config.url?.endsWith("/depth/status")) data = { status: "ready", engine: "test-service" };
    if (config.url === "/canvas-host/reference-uploads") {
        uploadCount++;
        if (uploadFailure) return { status: 200, statusText: "OK", headers: {}, config, data: { code: 4001, msg: "upload refused", reason: "upload_refused" } };
        activeUploads++;
        maxUploads = Math.max(maxUploads, activeUploads);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeUploads--;
        data = { r1: "https://media.example/ref.png", r2: "http://unsafe.example/ref.png" };
    }
    return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "ok", data } };
};

afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    globalThis.window = originalWindow;
});

describe("canvas service boundary", () => {
    it("bootstraps without a native bridge or patching fetch", () => {
        const fetchBefore = globalThis.fetch;
        bootstrapCanvasHost();
        expect(apiBaseURL).toBe("https://canvas.example/api");
        expect(globalThis.fetch).toBe(fetchBefore);
        expect(apiClient.defaults.headers.common["X-Desktop-Token"]).toBeUndefined();
        expect(usesServiceResourceRuntime()).toBe(true);
        expect(getCanvasHostServices()).toBe(getCanvasHostServices());
    });

    it("rejects API URLs containing credentials or non-HTTP protocols", () => {
        for (const apiBaseURL of ["file:///tmp/api", "https://user:secret@example.com/api", "https://example.com/api?token=x"]) {
            window.__CANVAS_CONFIG__ = { apiBaseURL };
            expect(() => bootstrapCanvasHost()).toThrow();
        }
        window.__CANVAS_CONFIG__ = { apiBaseURL: "/api" };
    });

    it("uses an explicit media storage policy", () => {
        window.__CANVAS_CONFIG__ = { resourceStorage: "browser" };
        expect(usesServiceResourceRuntime()).toBe(false);
        window.__CANVAS_CONFIG__ = {};
        expect(usesServiceResourceRuntime()).toBe(false);
        window.__CANVAS_CONFIG__ = { apiBaseURL: "/api" };
    });

    it("preserves real API failures instead of reporting a successful save", async () => {
        uploadFailure = true;
        try {
            await expect(uploadReferenceLinks([{ key: "first", label: "参考", resourceID: "r1" }])).rejects.toBeInstanceOf(ApiError);
        } finally { uploadFailure = false; }
    });

    it("uploads owned IDs once and only returns usable HTTPS references", async () => {
        const controller = new AbortController();
        const result = await uploadReferenceLinks([
            { key: "first", label: "参考", resourceID: "r1" },
            { key: "same", label: "重复", resourceID: "r1" },
            { key: "unsafe", label: "不安全", resourceID: "r2" },
            { key: "skip", label: "无需上传", resourceID: "r3", upload: false },
        ], controller.signal);
        expect(result).toEqual({ first: "https://media.example/ref.png", same: "https://media.example/ref.png" });
        const request = calls.filter(call => call.url === "/canvas-host/reference-uploads").at(-1)!;
        expect(request.data).toEqual({ resourceIds: ["r1", "r2"] });
        expect(request.signal).toBe(controller.signal);
    });

    it("serializes concurrent uploads so progress belongs to the active task", async () => {
        const reference = [{ key: "first", label: "参考", resourceID: "r1" }];
        await Promise.all([uploadReferenceLinks(reference), uploadReferenceLinks(reference)]);
        expect(maxUploads).toBe(1);
    });

    it("does not submit an already cancelled upload", async () => {
        const before = uploadCount;
        const controller = new AbortController();
        controller.abort();
        await expect(uploadReferenceLinks([{ key: "a", label: "参考", resourceID: "r1" }], controller.signal)).rejects.toHaveProperty("name", "AbortError");
        expect(uploadCount).toBe(before);
    });

    it("routes object-storage writes and depth checks through HTTP", async () => {
        const service = getCanvasHostServices();
        const config = await service.getReferenceStorage();
        await service.saveReferenceStorage({ ...config, secretAccessKey: "test-only-secret" });
        await service.testReferenceStorage();
        expect(await service.getDepthStatus()).toEqual({ status: "ready", engine: "test-service" });
        expect(calls.some(call => call.method === "put" && call.url === "/canvas-host/reference-storage")).toBe(true);
        expect(calls.some(call => call.method === "post" && call.url === "/canvas-host/reference-storage/test")).toBe(true);
    });
});
