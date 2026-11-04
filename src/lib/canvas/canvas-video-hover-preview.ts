// 优先复用节点已有的首帧 video，仅在缺少时创建临时播放器。
let stopCurrentPreview: (() => void) | undefined;
export const VIDEO_HOVER_DELAY_MS = 350;
export const VIDEO_HOVER_PREVIEW_MS = 3000;

export function bindCanvasVideoHoverPreview(element: HTMLElement, resolveSource: (signal: AbortSignal) => Promise<{ url: string; release: () => void }>, getPreviewVideo?: () => HTMLVideoElement | null) {
    let stop: (() => void) | undefined;
    const enter = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.buttons || document.hidden
            || window.matchMedia("(prefers-reduced-motion: reduce)").matches
            || element.closest('[data-canvas-viewport-interacting="true"]')) return;
        stopCurrentPreview?.();
        let disposed = false;
        let video: HTMLVideoElement | undefined;
        let ownsVideo = false;
        let releaseSource: (() => void) | undefined;
        let playbackTimer: ReturnType<typeof setTimeout> | undefined;
        const listeners = new AbortController();
        const viewport = element.closest("[data-canvas-viewport]");
        const visibility = new IntersectionObserver((entries) => {
            if (entries.some((entry) => !entry.isIntersecting)) cancel();
        });
        const observer = new MutationObserver(() => {
            if (viewport?.getAttribute("data-canvas-viewport-interacting") === "true") cancel();
        });
        const cancel = () => {
            if (disposed) return;
            disposed = true;
            clearTimeout(delay);
            clearTimeout(deadline);
            clearTimeout(playbackTimer);
            listeners.abort();
            observer.disconnect();
            visibility.disconnect();
            if (video) {
                video.pause();
                if (ownsVideo) {
                    video.style.opacity = "0";
                    video.remove();
                    video.removeAttribute("src");
                    video.load();
                } else if (video.readyState >= 1) {
                    video.currentTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.001, video.duration / 2) : 0.001;
                }
            }
            releaseSource?.();
            releaseSource = undefined;
            if (stopCurrentPreview === cancel) stopCurrentPreview = undefined;
            if (stop === cancel) stop = undefined;
        };
        const delay = setTimeout(() => {
            // Explicit playback wins over an incidental hover.
            if (Array.from(document.querySelectorAll("video, audio")).some((media) => !(media as HTMLMediaElement).paused)) {
                cancel();
                return;
            }
            const previewVideo = getPreviewVideo?.();
            const sourcePromise = previewVideo
                ? Promise.resolve({ url: previewVideo.currentSrc || previewVideo.src, release: () => undefined })
                : resolveSource(listeners.signal);
            void sourcePromise.then((source) => {
                if (disposed) { source.release(); return; }
                releaseSource = source.release;
                if (!source.url || !element.isConnected || document.hidden) { cancel(); return; }
                ownsVideo = !previewVideo;
                video = previewVideo || document.createElement("video");
                if (ownsVideo) {
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = "metadata";
                    video.style.opacity = "0";
                    video.className = "pointer-events-none absolute inset-0 size-full rounded-[var(--node-radius)] bg-black object-contain";
                    video.setAttribute("aria-hidden", "true");
                    video.dataset.canvasHoverPreview = "true";
                }
                video.addEventListener("ended", cancel, { signal: listeners.signal });
                video.addEventListener("error", cancel, { signal: listeners.signal });
                video.addEventListener("timeupdate", () => {
                    if (video && video.currentTime >= VIDEO_HOVER_PREVIEW_MS / 1000) cancel();
                }, { signal: listeners.signal });
                video.addEventListener("playing", () => {
                    if (!playbackTimer) playbackTimer = setTimeout(cancel, VIDEO_HOVER_PREVIEW_MS);
                }, { signal: listeners.signal });
                if (ownsVideo && typeof video.requestVideoFrameCallback === "function") {
                    video.requestVideoFrameCallback(() => {
                        if (!disposed && video) video.style.opacity = "1";
                    });
                } else if (ownsVideo) {
                    video.addEventListener("playing", () => {
                        requestAnimationFrame(() => requestAnimationFrame(() => {
                            if (!disposed && video) video.style.opacity = "1";
                        }));
                    }, { once: true, signal: listeners.signal });
                }
                if (ownsVideo) {
                    video.src = source.url;
                    element.appendChild(video);
                }
                void video.play().catch(cancel);
            }).catch(cancel);
        }, VIDEO_HOVER_DELAY_MS);
        // Bound stalled network/decoder sessions as well as actual playback.
        const deadline = setTimeout(cancel, 8000);
        stop = cancel;
        stopCurrentPreview = cancel;
        visibility.observe(element);
        if (viewport) observer.observe(viewport, { attributes: true, attributeFilter: ["data-canvas-viewport-interacting"] });
        for (const type of ["pointerdown", "wheel", "keydown", "blur"] as const) {
            window.addEventListener(type, cancel, { capture: true, passive: true, signal: listeners.signal });
        }
        document.addEventListener("visibilitychange", cancel, { signal: listeners.signal });
        document.addEventListener("play", (event) => { if (event.target !== video) cancel(); }, { capture: true, signal: listeners.signal });
    };
    const leave = () => stop?.();
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointercancel", leave);
    return () => {
        leave();
        element.removeEventListener("pointerenter", enter);
        element.removeEventListener("pointerleave", leave);
        element.removeEventListener("pointercancel", leave);
    };
}
