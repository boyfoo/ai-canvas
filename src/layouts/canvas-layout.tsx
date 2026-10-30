import { useEffect, useLayoutEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { ConfigProvider } from "antd";

import { WorkspaceOperationProgress } from "@/components/layout/workspace-operation-progress";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { useWorkspaceButtonFeedback } from "@/hooks/use-workspace-button-feedback";
import { cn } from "@/lib/utils";
import "@/styles/workspace-product.css";
import "@/styles/canvas-host.css";

const workspaceTheme = getWorkspaceAntThemeConfig();

export default function CanvasLayout() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const editor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const spatial = isSpatialWorkbenchPath(pathname);
    useWorkspaceButtonFeedback(!editor);

    useLayoutEffect(() => {
        document.body.classList.add("app-user-overlays");
        document.body.classList.toggle("app-spatial-overlays", spatial);
        document.body.classList.toggle("app-product-overlays", !editor);
        return () => document.body.classList.remove("app-user-overlays", "app-spatial-overlays", "app-product-overlays");
    }, [spatial, editor]);

    useEffect(() => {
        const navigateFromCanvas = (raw: Event) => {
            const event = raw as CustomEvent<{ to?: string }>;
            if (!event.detail?.to?.startsWith("/") || event.detail.to.startsWith("//")) return;
            event.preventDefault();
            void navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", navigateFromCanvas);
        return () => window.removeEventListener("workspace:navigate", navigateFromCanvas);
    }, [navigate]);

    return <ConfigProvider theme={editor ? undefined : workspaceTheme}>
        <div className={cn("app-user-workspace h-dvh overflow-hidden text-foreground flex flex-col", spatial && "app-spatial-workspace", !editor && "app-product-workspace")}>
            {!editor ? <nav className="canvas-host-nav" aria-label="画布功能导航">
                <Link to="/canvas">画布</Link>
                <Link to="/assets">素材</Link>
                <Link to="/skills">技能</Link>
                <Link to="/plugins">扩展</Link>
                <Link to="/settings?section=channels">模型设置</Link>
                <Link to="/settings?section=storage">参考素材与深度服务</Link>
            </nav> : null}
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden"><Outlet /></div>
            <WorkspaceOperationProgress />
        </div>
    </ConfigProvider>;
}
