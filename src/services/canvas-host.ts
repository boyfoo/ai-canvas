import { configureApiRuntime, http } from "@/services/api/request";
import { canvasHostConfig } from "@/lib/canvas-host-config";

export type ReferenceStorageConfig = {
    enabled: boolean;
    endpoint: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    publicBaseURL: string;
    hasSecret: boolean;
};

export type ReferenceUploadProgress = {
    label: string;
    phase: "preparing" | "transferring" | "processing";
    loadedBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
    startedAt: number;
    updatedAt: number;
};

export type DepthServiceState = {
    status: "ready" | "unavailable";
    engine?: string;
    detail?: string;
};

type RequestOptions = { signal?: AbortSignal };

/** Capabilities that previously crossed the Wails bridge. All writes stay on the service. */
export interface CanvasHostServices {
    getReferenceStorage(options?: RequestOptions): Promise<ReferenceStorageConfig>;
    saveReferenceStorage(config: ReferenceStorageConfig & { secretAccessKey: string }, options?: RequestOptions): Promise<ReferenceStorageConfig>;
    testReferenceStorage(options?: RequestOptions): Promise<void>;
    uploadReferenceMedia(ids: string[], options?: RequestOptions): Promise<Record<string, string>>;
    getReferenceUploadProgress?(options?: RequestOptions): Promise<ReferenceUploadProgress>;
    getDepthStatus(options?: RequestOptions): Promise<DepthServiceState>;
}

const httpServices: CanvasHostServices = {
    getReferenceStorage: (options) => http.get("/canvas-host/reference-storage", options),
    saveReferenceStorage: (config, options) => http.put("/canvas-host/reference-storage", config, options),
    testReferenceStorage: (options) => http.post("/canvas-host/reference-storage/test", undefined, { ...options, timeout: 60_000 }),
    uploadReferenceMedia: (ids, options) => http.post("/canvas-host/reference-uploads", { resourceIds: ids }, { ...options, timeout: 0 }),
    getReferenceUploadProgress: (options) => http.get("/canvas-host/reference-uploads/progress", options),
    getDepthStatus: (options) => http.get("/canvas-host/depth/status", options),
};

declare global {
    interface Window {
        /** Inject before main.tsx to adapt an existing backend without changing canvas code. */
        __CANVAS_SERVICES__?: Partial<CanvasHostServices>;
    }
}

let services: CanvasHostServices | undefined;

export function getCanvasHostServices(): CanvasHostServices {
    // Stable identity is required by settings and capability-check effects.
    return services ??= { ...httpServices, ...(typeof window === "undefined" ? {} : window.__CANVAS_SERVICES__) };
}

export function bootstrapCanvasHost() {
    const configured = canvasHostConfig().apiBaseURL || import.meta.env.VITE_CANVAS_BACKEND_URL || "/api";
    const url = new URL(configured, window.location.origin);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("画布 API 地址必须是无凭据、查询参数和片段的 HTTP(S) 地址");
    }
    configureApiRuntime(url.href.replace(/\/+$/u, ""));
}
