export type CanvasHostConfig = {
    /** Same-origin API is recommended for cookie auth, media and SSE. */
    apiBaseURL?: string;
    resourceStorage?: "service" | "browser";
};

declare global {
    interface Window {
        __CANVAS_CONFIG__?: CanvasHostConfig;
    }
}

export function canvasHostConfig(): CanvasHostConfig {
    return typeof window === "undefined" ? {} : window.__CANVAS_CONFIG__ || {};
}

/** 工具服务须显式接入，基础画布不探测或等待本机端口。 */
export function hasCanvasBackend() {
    return Boolean(canvasHostConfig().apiBaseURL || import.meta.env.VITE_CANVAS_BACKEND_URL);
}

export function usesServiceResourceRuntime() {
    return (canvasHostConfig().resourceStorage || import.meta.env.VITE_CANVAS_RESOURCE_STORAGE || "browser") === "service";
}
