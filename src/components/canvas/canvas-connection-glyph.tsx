import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";

/** 仅绘制连接圆钮；命中区域及连线事件继续由节点内的按钮负责。 */
export function CanvasConnectionGlyph({ anchorRef, side, color, background }: {
    anchorRef: RefObject<HTMLSpanElement | null>;
    side: "left" | "right";
    color: string;
    background: string;
}) {
    const glyphRef = useRef<HTMLSpanElement>(null);
    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        setContainer(anchorRef.current?.closest<HTMLDivElement>("[data-canvas-viewport]") ?? null);
    }, [anchorRef]);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const glyph = glyphRef.current;
        if (!container || !anchor || !glyph) return;

        const update = () => {
            const bounds = anchor.getBoundingClientRect();
            const host = container.getBoundingClientRect();
            const ratio = window.devicePixelRatio;
            // 1px 描边占奇数个物理像素时，中心落在半像素；圆圈和加号共用此中心。
            const phase = (Math.round(ratio) % 2) / 2;
            const centerX = (bounds.left + bounds.width / 2) * ratio - phase;
            const centerY = (bounds.top + bounds.height / 2) * ratio - phase;
            // 水平方向向节点外侧取整，像素对齐也不侵占边框间距。
            const x = ((side === "left" ? Math.floor(centerX) : Math.ceil(centerX)) + phase) / ratio;
            const y = (Math.round(centerY) + phase) / ratio;
            glyph.style.left = `${x - host.left - container.clientLeft - 10}px`;
            glyph.style.top = `${y - host.top - container.clientTop - 10}px`;
            glyph.style.visibility = bounds.width > 0 && bounds.height > 0 ? "visible" : "hidden";
        };

        update();
        // 复用现有的逐帧镜头、节点拖动通知，不新增轮询或每帧 React 状态更新。
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, update);
        const unsubscribeDrag = subscribeCanvasNodeDragPreview(container, update);
        const node = anchor.closest<HTMLElement>("[data-node-id]");
        const mutations = new MutationObserver(update);
        mutations.observe(anchor, { attributes: true, attributeFilter: ["style"] });
        if (node) mutations.observe(node, { attributes: true, attributeFilter: ["style"] });
        const resize = new ResizeObserver(update);
        resize.observe(container);
        if (node) resize.observe(node);
        window.addEventListener("resize", update);
        return () => {
            unsubscribeViewport();
            unsubscribeDrag();
            mutations.disconnect();
            resize.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [anchorRef, container, side]);

    if (!container) return null;
    return createPortal(
        <span
            ref={glyphRef}
            aria-hidden="true"
            data-canvas-connection-glyph={side}
            className="pointer-events-none absolute z-[var(--node-z-overlay)] block rounded-full"
            style={{
                width: 20,
                height: 20,
                visibility: "hidden",
                border: "1px solid currentColor",
                background,
                color,
                transition: "color 120ms ease-out",
            }}
        >
            {/* 固定 20px 视口与外圈同心，直接按屏幕尺寸绘制，不经过画布反向缩放。 */}
            <svg className="absolute -left-px -top-px block" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M6 10h8M10 6v8" stroke="currentColor" strokeWidth="1" />
            </svg>
        </span>,
        container,
    );
}
