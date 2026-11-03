import { animate, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import type { CanvasConnectionTilt } from "@/lib/canvas/canvas-connection-tilt";

const flat = { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 };
const spring = { type: "spring", stiffness: 300, damping: 22, mass: 0.7 } as const;

/** 仅合法目标及离开后的短暂回正使用 Motion；普通节点不创建动画或持续 RAF。 */
export function useCanvasConnectionFeedback(surfaceRef: RefObject<HTMLDivElement | null>, tilt: CanvasConnectionTilt) {
    const reducedMotion = useReducedMotion();
    const controls = useRef<ReturnType<typeof animate> | null>(null);
    const engaged = useRef(false);

    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        if (reducedMotion || surface.closest(".no-motion")) {
            controls.current?.stop();
            controls.current = null;
            engaged.current = false;
            surface.style.removeProperty("transform");
            delete surface.dataset.connectionMotion;
            return;
        }
        if (!tilt && !engaged.current) return;

        engaged.current = Boolean(tilt);
        surface.dataset.connectionMotion = "true";
        // 固定透视，不将 perspective 从 0 弹到 760；各运动轴交给成熟弹簧实现接续。
        // 新命令会接管同一元素的运动轴，快速移动线头时仍从当前显示状态继续。
        const next = animate(surface, { ...(tilt ?? flat), transformPerspective: [760, 760] }, spring);
        controls.current = next;
        if (!tilt) void next.then(() => {
            if (controls.current !== next || engaged.current || !surface.isConnected) return;
            surface.style.removeProperty("transform");
            delete surface.dataset.connectionMotion;
            controls.current = null;
        });
    }, [surfaceRef, reducedMotion, tilt?.x, tilt?.y, tilt?.z, tilt?.rotateX, tilt?.rotateY, tilt?.rotateZ, tilt?.scale]);

    useEffect(() => () => {
        controls.current?.stop();
        controls.current = null;
    }, []);
}
