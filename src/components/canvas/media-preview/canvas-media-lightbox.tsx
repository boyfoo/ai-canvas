import type { ReactNode } from "react";

import { AppModal } from "@/components/ui/product/app-modal";

export type CanvasMediaLightboxProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
};

/**
 * 透明预览层，复用 AppModal 的遮罩、Esc、焦点管理与关闭后的内容销毁。
 * 仅媒体和控件恢复 pointer-events，空白继续由遮罩关闭。
 * 不使用 flush，避免 overflow:hidden 裁掉悬浮在媒体外的关闭按钮。
 */
export function CanvasMediaLightbox({ open, title, onClose, children }: CanvasMediaLightboxProps) {
    return <AppModal
        open={open}
        title={<span className="sr-only">{title}</span>}
        closable={false}
        footer={null}
        width="min(560px, calc(100vw - 32px))"
        onCancel={onClose}
        styles={{
            container: { padding: 0, overflow: "visible", pointerEvents: "none", background: "transparent", border: 0, borderRadius: 0, boxShadow: "none" },
            body: { padding: 0 },
            header: { margin: 0, height: 0, padding: 0, border: 0, background: "transparent" },
        }}
    >{children}</AppModal>;
}
