import { useUserStore } from "@/stores/use-user-store";
import { usesServiceResourceRuntime } from "@/lib/canvas-host-config";

export type RuntimeSessionLike = {
    storageMode?: "local" | "remote";
    user?: { username?: string } | null;
};

/**
 * Pure runtime-mode decision used by persistence and upload boundaries.
 * Local-first is the workspace data model; hosted mode must opt out
 * explicitly with VITE_CANVAS_LOCAL_MODE=false.
 */
export function isLocalRuntimeModeForSession(session: RuntimeSessionLike, localFirstBuild: boolean) {
    return localFirstBuild || session.storageMode === "local" || session.user?.username === "local";
}

export function isLocalRuntimeMode() {
    return isLocalRuntimeModeForSession(
        useUserStore.getState(),
        import.meta.env.VITE_CANVAS_LOCAL_MODE !== "false",
    );
}

/** Explicit storage policy, independent of protocol and loopback addresses. */
export function isServiceResourceRuntime() {
    return usesServiceResourceRuntime();
}
