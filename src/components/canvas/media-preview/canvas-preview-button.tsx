import type { CSSProperties } from "react";
import { Button, type ButtonProps } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { cn } from "@/lib/utils";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasPreviewButtonProps = Pick<ButtonProps, "icon" | "children" | "disabled" | "onClick" | "title"> & {
    label: string;
    floating?: boolean;
    className?: string;
    style?: CSSProperties;
};

/** 预览动作沿用 AntD 按钮与画布 Dock 主题；只反馈亮度，不缩放，也不管理业务状态或关闭行为。 */
export function CanvasPreviewButton({ label, floating = false, icon, children, disabled, onClick, title, className, style }: CanvasPreviewButtonProps) {
    const theme = canvasThemes[useActiveTheme()];
    const floatingStyle: CSSProperties | undefined = floating ? {
        ...canvasDockStyle(theme),
        background: "color-mix(in srgb, var(--dock-surface) 97%, white 3%)",
        color: theme.toolbar.item,
        opacity: disabled ? 0.35 : 1,
    } : undefined;

    return <Button
        data-slot="canvas-preview-button"
        type="text"
        shape={children === undefined ? "circle" : undefined}
        icon={icon}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        title={title ?? label}
        className={cn("pointer-events-auto transform-none! enabled:hover:brightness-110 enabled:active:brightness-95", floating && "backdrop-blur-xl", className)}
        style={{ ...floatingStyle, ...style }}
    >{children}</Button>;
}
