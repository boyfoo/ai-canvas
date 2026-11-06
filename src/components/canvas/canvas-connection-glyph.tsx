import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";

/** 仅绘制连接圆钮；命中区域及连线事件继续由节点内的按钮负责。 */
export function CanvasConnectionGlyph({ anchorRef, side, theme, active }: {
    anchorRef: RefObject<HTMLSpanElement | null>;
    side: "left" | "right";
    theme: CanvasTheme;
    active: boolean;
}) {
    const glyphRef = useRef<HTMLSpanElement>(null);
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const [motionDisabled, setMotionDisabled] = useState(false);
    const reducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        setContainer(anchor?.closest<HTMLDivElement>("[data-canvas-viewport]") ?? null);
        setMotionDisabled(Boolean(anchor?.closest(".no-motion")));
    }, [anchorRef]);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const glyph = glyphRef.current;
        if (!container || !anchor || !glyph) return;

        const update = () => {
            const bounds = anchor.getBoundingClientRect();
            const host = container.getBoundingClientRect();
            const diameter = bounds.width;
            const ratio = window.devicePixelRatio;
            // 1px 描边占奇数个物理像素时，中心落在半像素；圆圈和加号共用此中心。
            const phase = (Math.round(ratio) % 2) / 2;
            const centerX = (bounds.left + bounds.width / 2) * ratio - phase;
            const centerY = (bounds.top + bounds.height / 2) * ratio - phase;
            // 水平方向向节点外侧取整，像素对齐也不侵占边框间距。
            const x = ((side === "left" ? Math.floor(centerX) : Math.ceil(centerX)) + phase) / ratio;
            const y = (Math.round(centerY) + phase) / ratio;
            glyph.style.setProperty("--canvas-connection-glyph-size", `${diameter}px`);
            glyph.style.left = `${x - host.left - container.clientLeft - diameter / 2}px`;
            glyph.style.top = `${y - host.top - container.clientTop - diameter / 2}px`;
            glyph.style.visibility = bounds.width > 0 && bounds.height > 0 ? "visible" : "hidden";
        };

        update();
        // 复用现有的逐帧镜头、节点拖动通知，不新增轮询或每帧 React 状态更新。
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, update);
        const unsubscribeDrag = subscribeCanvasNodeDragPreview(container, update);
        const node = anchor.closest<HTMLElement>("[data-node-id]");
        const mutations = new MutationObserver((records) => {
            if (records.some((record) => record.attributeName === "class")) {
                setMotionDisabled(Boolean(anchor.closest(".no-motion")));
            }
            update();
        });
        for (let ancestor: HTMLElement | null = anchor; ancestor; ancestor = ancestor.parentElement) {
            mutations.observe(ancestor, { attributes: true, attributeFilter: ancestor === anchor || ancestor === node ? ["style", "class"] : ["class"] });
        }
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
    const noMotion = reducedMotion || motionDisabled;
    const hidden = { opacity: 0, scale: noMotion ? 1 : 0.72, x: noMotion ? 0 : side === "left" ? "50%" : "-50%" };
    return createPortal(
        <motion.span
            ref={glyphRef}
            aria-hidden="true"
            data-canvas-connection-glyph={side}
            className="pointer-events-none absolute z-[var(--node-z-overlay)] block rounded-full"
            // 显隐只变换图形，最终尺寸、定位锚点与命中区域保持独立。
            initial={noMotion ? false : hidden}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ ...hidden, transition: { duration: noMotion ? 0 : 0.32, ease: "easeInOut" } }}
            transition={noMotion ? { duration: 0 } : {
                type: "spring",
                duration: 0.32,
                bounce: 0.18,
                opacity: { duration: 0.16, ease: "easeOut" },
            }}
            style={{
                width: "var(--canvas-connection-glyph-size)",
                height: "var(--canvas-connection-glyph-size)",
                visibility: "hidden",
                border: `1px solid ${active ? "transparent" : theme.toolbar.border}`,
                background: active ? theme.node.activeStroke : `color-mix(in srgb, ${theme.node.fill} 70%, transparent)`,
                color: active ? theme.accent.onPrimary : theme.node.text,
                transition: noMotion ? "none" : "color 120ms ease-out, background-color 120ms ease-out, border-color 120ms ease-out",
            }}
        >
            {/* 按真实容器中心定位，不用固定偏移抵消边框；浏览器缩放会量化边框宽度。 */}
            <svg className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2" style={{ width: "var(--canvas-connection-glyph-size)", height: "var(--canvas-connection-glyph-size)" }} viewBox="0 0 20 20" fill="none">
                <path d="M6 10h8M10 6v8" stroke="currentColor" strokeWidth="1" />
            </svg>
        </motion.span>,
        container,
    );
}
