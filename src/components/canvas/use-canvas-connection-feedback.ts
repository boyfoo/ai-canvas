import { animate, useReducedMotion, visualElementStore } from "motion/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import type { CanvasConnectionTilt } from "@/lib/canvas/canvas-connection-tilt";
import { beginCanvasConnectionImpactPreview, type CanvasConnectionImpactFeedback } from "@/lib/canvas/canvas-live-viewport";

const flat = { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 };
const spring = { type: "spring", stiffness: 300, damping: 22, mass: 0.7 } as const;
const impactEvent = "canvas-connection-impact";

/** 同步清除拖线倾斜，成功位移与光波统一由连线场景的同一个 RAF 推进。 */
export function prepareCanvasConnectionImpact(container: HTMLElement, nodeId: string): CanvasConnectionImpactFeedback | null {
    if (!container.isConnected) return null;
    const surface = container.querySelector<HTMLDivElement>(`[data-node-id="${CSS.escape(nodeId)}"] > .canvas-node-motion-surface`);
    if (!surface) return null;
    surface.dispatchEvent(new CustomEvent(impactEvent));
    return beginCanvasConnectionImpactPreview(container, nodeId);
}

/** 只负责拖线目标倾斜与移出回弹；接线结束或成功反馈准备时立即回正。 */
export function useCanvasConnectionFeedback(surfaceRef: RefObject<HTMLDivElement | null>, tilt: CanvasConnectionTilt, connectionActive: boolean) {
    const reducedMotion = useReducedMotion();
    const hoverControls = useRef<ReturnType<typeof animate> | null>(null);
    const engaged = useRef(false);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        if (!connectionActive || reducedMotion || surface.closest(".no-motion")) {
            if (!hoverControls.current && !engaged.current && !surface.dataset.connectionMotion) return;
            hoverControls.current?.stop();
            hoverControls.current = null;
            engaged.current = false;
            resetConnectionTransform(surface);
            return;
        }
        if (!tilt && !engaged.current) return;

        engaged.current = Boolean(tilt);
        surface.dataset.connectionMotion = "true";
        // 固定透视，不将 perspective 从 0 弹到 760；各运动轴交给成熟弹簧实现接续。
        // 新命令会接管同一元素的运动轴，快速移动线头时仍从当前显示状态继续。
        const next = animate(surface, { ...(tilt ?? flat), transformPerspective: [760, 760] }, spring);
        hoverControls.current = next;
        if (!tilt) void next.then(() => {
            if (hoverControls.current !== next || engaged.current || !surface.isConnected) return;
            surface.style.removeProperty("transform");
            delete surface.dataset.connectionMotion;
            hoverControls.current = null;
        });
    }, [surfaceRef, reducedMotion, connectionActive, tilt?.x, tilt?.y, tilt?.z, tilt?.rotateX, tilt?.rotateY, tilt?.rotateZ, tilt?.scale]);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        const prepareImpact = () => {
            hoverControls.current?.stop();
            hoverControls.current = null;
            engaged.current = false;
            resetConnectionTransform(surface);
        };
        surface.addEventListener(impactEvent, prepareImpact);
        return () => surface.removeEventListener(impactEvent, prepareImpact);
    }, [surfaceRef]);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        return () => {
            hoverControls.current?.stop();
            hoverControls.current = null;
            engaged.current = false;
            if (surface) resetConnectionTransform(surface);
        };
    }, [surfaceRef]);
}

function resetConnectionTransform(surface: HTMLDivElement) {
    const visual = visualElementStore.get(surface);
    // 先归零轴值和速度，再解绑旧轴；只清 DOM 样式会被已排队的旧动画写回。
    if (visual) {
        for (const [axis, value] of Object.entries({ ...flat, transformPerspective: 0 })) {
            visual.getValue(axis)?.jump(value);
            visual.removeValue(axis);
        }
        visual.render();
    }
    surface.style.removeProperty("transform");
    delete surface.dataset.connectionMotion;
}
