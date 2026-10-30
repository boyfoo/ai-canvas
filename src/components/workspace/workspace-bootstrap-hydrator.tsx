import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { appPathname } from "@/lib/app-routing";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { applyUserSession, localWorkspaceConfig } from "@/lib/user-session";
import type { WorkspaceBootstrapPayload } from "@/services/api/workspace";
import { commitModelConfig, flushModelConfig, hydrateModelConfig } from "@/services/model-config-repository";
import { normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceBootstrapHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const modelConfigReady = useRef(false);
    const [restoreStatus, setRestoreStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        let cancelled = false;
        void initializeWorkspaceState({
            createLocalWorkspace: createLocalWorkspacePayload,
            applySession: applyUserSession,
            restoreModelConfig: hydrateLocalModelConfig,
        })
            .then(() => {
                if (cancelled) return;
                modelConfigReady.current = true;
                setRestoreStatus("ready");
                preloadWorkspaceRoute(appPathname());
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("浏览器工作区读取失败", error);
                modelConfigReady.current = false;
                useUserStore.getState().setHydrated(true);
                setRestoreStatus("error");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let ready = false;
        const unsubscribe = useConfigStore.subscribe((state) => {
            if (!shouldSaveLocalModelConfig({ subscriptionReady: ready, modelConfigReady: modelConfigReady.current })) return;
            void commitModelConfig(state.config);
        });
        const flush = () => { void flushModelConfig(); };
        window.addEventListener("pagehide", flush);
        const markReady = () => { ready = true; };
        if (modelConfigReady.current) markReady();
        else window.setTimeout(markReady, 0);
        return () => {
            unsubscribe();
            window.removeEventListener("pagehide", flush);
            void flushModelConfig();
        };
    }, []);

    if (restoreStatus === "error") return <WorkspaceErrorState title="浏览器本地存储无法读取" description="请确认当前浏览器允许此网站使用本地存储，然后重新加载。原有项目和模型配置不会被覆盖。" onRetry={() => window.location.reload()} />;
    return hydrated && restoreStatus === "ready" ? children : <FullScreenLoader label="正在准备本地工作区" detail="加载项目、画布与模型配置" />;
}

export async function initializeWorkspaceState<T>({
    createLocalWorkspace,
    applySession,
    restoreModelConfig,
}: {
    createLocalWorkspace: () => T;
    applySession: (payload: T) => Promise<void>;
    restoreModelConfig: () => Promise<void>;
}) {
    await applySession(createLocalWorkspace());
    await restoreModelConfig();
}

export function shouldSaveLocalModelConfig({ subscriptionReady, modelConfigReady }: { subscriptionReady: boolean; modelConfigReady: boolean }) {
    return subscriptionReady && modelConfigReady;
}

async function hydrateLocalModelConfig() {
    const result = await hydrateModelConfig();
    const normalizedConfig = localWorkspaceConfig(normalizeConfigSnapshot({ config: result.config }).config);
    useConfigStore.getState().replaceConfig(normalizedConfig);
}

function createLocalWorkspacePayload(): WorkspaceBootstrapPayload {
    return {
        contractVersion: 1,
        profile: "local",
        capabilities: {
            localAssets: true,
            providerCalls: true,
        },
        user: { id: "local", username: "local", displayName: "本地工作区", role: "user", status: "active", createdAt: "", updatedAt: "" },
        workspace: { id: "local", name: "本地工作区", owner: "local", storage: "indexeddb" },
        storageMode: "local",
        features: { shortDramaEnabled: true, taskCenterEnabled: true, customChannelsEnabled: true, frontendModelsEnabled: false, pluginCenterEnabled: true, systemPluginsVisibleToUsers: true },
    };
}
