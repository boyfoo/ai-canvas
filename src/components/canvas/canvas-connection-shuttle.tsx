import { useId, useLayoutEffect, useRef } from "react";

/** 尺寸、速度和间歇都以屏幕 CSS 像素为单位，与画布缩放无关。 */
const SHUTTLE_LENGTH = 36;
const SHUTTLE_SPEED = 95;
const SHUTTLE_GAP = SHUTTLE_SPEED * 0.35;
const SHUTTLE_WIDTH = 1.8;
const SHUTTLE_GLOW_WIDTH = 3.6;
const SHUTTLE_GLOW_BLUR = 0.9;

/**
 * 连线的短光梭。画布仅在选中节点的关联线上挂载，退出关联状态即释放计时和监听。
 *
 * pathD 保持整条连线几何，父层拖动／回弹可继续同步更新所有 path[d]。
 * 亮芯与窄柔光共用单段 dash 和局部渐变，只显示其中 36px，不改连接命中或节点数据。
 */
export function CanvasConnectionShuttle({ pathD, color }: { pathD: string; color: string }) {
    const gradientId = useId();
    const groupRef = useRef<SVGGElement>(null);
    const pathRef = useRef<SVGPathElement>(null);
    const glowRef = useRef<SVGPathElement>(null);
    const gradientRef = useRef<SVGLinearGradientElement>(null);

    useLayoutEffect(() => {
        const group = groupRef.current;
        const path = pathRef.current;
        const glow = glowRef.current;
        const gradient = gradientRef.current;
        if (!group || !path || !glow || !gradient) return;
        const strokePaths = [glow, path];

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const ancestors: Element[] = [];
        for (let element: Element | null = group; element; element = element.parentElement) ancestors.push(element);
        const viewport = group.closest<HTMLElement>("[data-canvas-viewport]");
        let frame: number | null = null;
        let previousTime: number | null = null;
        let distance = 0;
        let measuredPath: string | null = null;
        let pathLength = 0;
        let disposed = false;

        const hide = () => { group.style.opacity = "0"; };
        const stop = () => {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            previousTime = null;
            group.dataset.canvasShuttleRunning = "false";
            hide();
        };
        const draw = (now: number) => {
            frame = null;
            if (disposed) return;
            const elapsed = previousTime === null ? 0 : Math.min((now - previousTime) / 1000, 0.064);
            previousTime = now;

            // 父层可在 React 提交前直接更新 d；按实际显示的路径重新量弧长。
            const currentPath = path.getAttribute("d");
            if (currentPath !== measuredPath) {
                measuredPath = currentPath;
                pathLength = path.getTotalLength();
            }
            const inverseScale = Number.parseFloat(getComputedStyle(path).getPropertyValue("--canvas-wire-inverse-scale"));
            if (pathLength > 0 && inverseScale > 0) {
                const screenLength = pathLength / inverseScale;
                const cycle = screenLength + SHUTTLE_LENGTH + SHUTTLE_GAP;
                distance = (distance + elapsed * SHUTTLE_SPEED) % cycle;
                const tail = SHUTTLE_LENGTH * inverseScale;
                const head = distance * inverseScale;
                for (const strokePath of strokePaths) {
                    strokePath.setAttribute("stroke-dasharray", `${tail} ${pathLength + SHUTTLE_GAP * inverseScale}`);
                    strokePath.setAttribute("stroke-dashoffset", String(tail - head));
                }

                // 全路径的单段 dash 沿弧长行进；局部渐变随线头和线尾移动，
                // 避免固定整线渐变导致光梭经过不同位置时忽明忽暗。
                if (distance > 0 && distance < screenLength + SHUTTLE_LENGTH) {
                    const start = path.getPointAtLength(Math.max(0, head - tail));
                    const end = path.getPointAtLength(Math.min(pathLength, head));
                    gradient.setAttribute("x1", String(start.x));
                    gradient.setAttribute("y1", String(start.y));
                    gradient.setAttribute("x2", String(end.x));
                    gradient.setAttribute("y2", String(end.y));
                    group.style.opacity = "0.95";
                } else hide();
            } else hide();
            frame = requestAnimationFrame(draw);
        };
        const syncPlayback = () => {
            const paused = document.hidden || reducedMotion.matches || ancestors.some((element) => element.classList.contains("no-motion")) || viewport?.dataset.canvasViewportInteracting === "true";
            if (paused) {
                stop();
                return;
            }
            if (frame === null) {
                group.dataset.canvasShuttleRunning = "true";
                frame = requestAnimationFrame(draw);
            }
        };

        // 只观察祖先自己的相关属性，不监听整个文档子树的节点悬停或媒体变化。
        const observer = new MutationObserver(syncPlayback);
        for (const ancestor of ancestors) observer.observe(ancestor, { attributes: true, attributeFilter: ["class", "data-canvas-viewport-interacting"] });
        document.addEventListener("visibilitychange", syncPlayback);
        reducedMotion.addEventListener("change", syncPlayback);
        syncPlayback();

        return () => {
            disposed = true;
            stop();
            observer.disconnect();
            document.removeEventListener("visibilitychange", syncPlayback);
            reducedMotion.removeEventListener("change", syncPlayback);
        };
    }, []);

    return (
        <g ref={groupRef} className="canvas-connection-shuttle" data-canvas-connection-shuttle aria-hidden="true" style={{ pointerEvents: "none", opacity: 0 }}>
            <defs>
                <linearGradient ref={gradientRef} id={gradientId} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor={color} stopOpacity="0" />
                    <stop offset="0.3" stopColor={color} stopOpacity="0.7" />
                    <stop offset="0.5" stopColor={color} stopOpacity="1" />
                    <stop offset="0.7" stopColor={color} stopOpacity="0.7" />
                    <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            {/* 柔光与亮芯使用完全相同的短段，避免重新出现整条线的常驻发光。 */}
            <path
                ref={glowRef}
                data-canvas-shuttle-glow
                d={pathD}
                stroke={`url(#${gradientId})`}
                strokeWidth={SHUTTLE_GLOW_WIDTH}
                strokeOpacity={0.26}
                vectorEffect="non-scaling-stroke"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeWidth: `calc(${SHUTTLE_GLOW_WIDTH}px * var(--canvas-wire-inverse-scale))`, filter: `blur(calc(${SHUTTLE_GLOW_BLUR}px * var(--canvas-wire-inverse-scale)))` }}
            />
            <path
                ref={pathRef}
                data-canvas-shuttle-core
                d={pathD}
                stroke={`url(#${gradientId})`}
                strokeWidth={SHUTTLE_WIDTH}
                vectorEffect="non-scaling-stroke"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeWidth: `calc(${SHUTTLE_WIDTH}px * var(--canvas-wire-inverse-scale))` }}
            />
        </g>
    );
}
