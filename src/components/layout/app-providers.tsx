import type { ReactNode } from "react";
import { lazy, Suspense, useLayoutEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { WorkspaceBootstrapHydrator } from "@/components/workspace/workspace-bootstrap-hydrator";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme } from "@/lib/skin-themes";
import { appQueryClient } from "@/lib/query-client";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { applyAppearanceMetadata, useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

const ClientRootInit = lazy(() => import("@/components/layout/client-root-init").then((module) => ({ default: module.ClientRootInit })));

function ClientRootBoundary({ children }: { children: ReactNode }) {
    const authenticated = useUserStore((state) => Boolean(state.user));
    if (!authenticated) return children;
    return <Suspense fallback={<FullScreenLoader label="正在准备创作环境" detail="连接本地能力与模型配置" />}><ClientRootInit>{children}</ClientRootInit></Suspense>;
}

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useActiveTheme();
    const dark = theme === "dark";
    const appearance = useAppearanceStore((state) => state.appearance);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        applySkinTheme(appearance.activeSkin, theme);
        applyAppearanceMetadata(appearance);
    }, [appearance, dark, theme]);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark, appearance.activeSkin)} modal={{ centered: true }}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    <WorkspaceBootstrapHydrator>
                        <ClientRootBoundary>{children}</ClientRootBoundary>
                    </WorkspaceBootstrapHydrator>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
