import { animate, useReducedMotion, visualElementStore } from "motion/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import type { CanvasConnectionTilt } from "@/lib/canvas/canvas-connection-tilt";

const flat = { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 };
const spring = { type: "spring", stiffness: 300, damping: 22, mass: 0.7 } as const;
const impactEvent = "canvas-connection-impact";
type ConnectionImpact = { side: "left" | "right" };

/** 仅由真实新增连接触发，等布局阶段清除拖线倾斜后再播放成功反馈。 */
export function playCanvasConnectionImpact(container: HTMLElement, nodeId: string, side: "left" | "right") {
    queueMicrotask(() => {
        requestAnimationFrame(() => {
            if (!container.isConnected) return;
            const surface = container.querySelector<HTMLDivElement>(`[data-node-id="${CSS.escape(nodeId)}"] > .canvas-node-motion-surface`);
            surface?.dispatchEvent(new CustomEvent<ConnectionImpact>(impactEvent, { detail: { side } }));
        });
    });
}

/** 拖线时保留目标倾斜与移出回弹；结束立即回正，成功接入单独播放纯 2D 位移回弹。 */
export function useCanvasConnectionFeedback(surfaceRef: RefObject<HTMLDivElement | null>, tilt: CanvasConnectionTilt, connectionActive: boolean) {
    const reducedMotion = useReducedMotion();
    const hoverControls = useRef<ReturnType<typeof animate> | null>(null);
    const impactControls = useRef<ReturnType<typeof animate> | null>(null);
    const engaged = useRef(false);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        if (!connectionActive || reducedMotion || surface.closest(".no-motion")) {
            if (!hoverControls.current && !impactControls.current && !engaged.current && !surface.dataset.connectionMotion) return;
            hoverControls.current?.stop();
            hoverControls.current = null;
            impactControls.current?.stop();
            impactControls.current = null;
            engaged.current = false;
            resetConnectionTransform(surface);
            return;
        }
        if (impactControls.current) {
            impactControls.current.stop();
            impactControls.current = null;
            resetConnectionTransform(surface);
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
        const playImpact = (event: Event) => {
            if (connectionActive || reducedMotion || !surface.isConnected || surface.closest(".no-motion")) return;
            const { side } = (event as CustomEvent<ConnectionImpact>).detail;
            hoverControls.current?.stop();
            hoverControls.current = null;
            impactControls.current?.stop();
            impactControls.current = null;
            engaged.current = false;
            resetConnectionTransform(surface);
            surface.dataset.connectionMotion = "true";

            // 用节点几何而非固定屏幕 20px 提示圈标定世界位移，镜头缩放直接作用于同一回弹。
            // x/y 共用节点宽度保留参考位移方向；缩放、3D 轴与透视保持复位。
            const width = surface.clientWidth;
            const distance = width * 0.03;
            const direction = side === "left" ? 1 : -1;
            let pulse: ReturnType<typeof animate> | null = null;
            pulse = animate(surface, {
                x: [0, direction * distance, -direction * distance * 0.15, 0],
                y: [0, -distance * 0.225, distance * 0.03, 0],
            }, {
                duration: 0.56,
                times: [0, 0.22, 0.7, 1],
                ease: "easeOut",
                onUpdate: () => {
                    if (!pulse || impactControls.current !== pulse || (surface.isConnected && !surface.closest(".no-motion"))) return;
                    pulse.stop();
                    impactControls.current = null;
                    resetConnectionTransform(surface);
                },
            });
            impactControls.current = pulse;
            const current = pulse;
            void current.then(() => {
                if (impactControls.current !== current || !surface.isConnected) return;
                impactControls.current = null;
                resetConnectionTransform(surface);
            });
        };
        surface.addEventListener(impactEvent, playImpact);
        return () => surface.removeEventListener(impactEvent, playImpact);
    }, [surfaceRef, reducedMotion, connectionActive]);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        return () => {
            hoverControls.current?.stop();
            hoverControls.current = null;
            impactControls.current?.stop();
            impactControls.current = null;
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
