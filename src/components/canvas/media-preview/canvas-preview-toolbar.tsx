import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { cn } from "@/lib/utils";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasPreviewToolbarProps = {
    label: string;
    children: ReactNode;
    className?: string;
};

/** 媒体预览悬浮工具条，统一 Dock 主题与可访问分组；不管理选择、导航或版本状态。 */
export function CanvasPreviewToolbar({ label, children, className }: CanvasPreviewToolbarProps) {
    const theme = canvasThemes[useActiveTheme()];
    return <div
        data-slot="canvas-preview-toolbar"
        role="toolbar"
        aria-label={label}
        className={cn("pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-[var(--dock-radius-tight)] px-2 py-1 backdrop-blur-2xl", className)}
        style={canvasDockStyle(theme)}
    >{children}</div>;
}
