import { cubicBezier, easeInOut, easeOut, interpolate, spring } from "motion";

/** 加号圆钮与接入口光圈共用的屏幕外径，包含各自描边；不随画布缩放。 */
export const connectionHandleDiameter = 20;

/** 统一使用画布世界坐标；scale 为世界坐标到屏幕 CSS 像素的倍率。 */
export interface CablePoint {
    x: number;
    y: number;
}

/** 接入回弹统一按毫秒采样，由调用方的现有动画时钟推进。 */
export const connectionImpactDuration = 560;

// 近似原片峰顶缓慢反向、随后加速的连续回程，不代表原片的物理参数。
// 回程与收尾的端点速度均为零，避免独立 easeOut 在峰顶骤然反向。
const impactOffsetAt = interpolate(
    [0, connectionImpactDuration * 0.22, connectionImpactDuration * 0.7, connectionImpactDuration],
    [0, 1, -0.15, 0],
    { ease: [easeOut, cubicBezier(0.6, 0, 0.7, 1), easeInOut] },
);

/** 节点、线头和光波共用世界位移；镜头自然缩放，水平按接入侧镜像。 */
export function cableImpactOffset(elapsed: number, width: number, side: "left" | "right"): CablePoint {
    if (elapsed <= 0 || elapsed >= connectionImpactDuration) return { x: 0, y: 0 };
    const distance = width * 0.02 * impactOffsetAt(elapsed);
    return { x: (side === "left" ? 1 : -1) * distance, y: -distance * 0.225 };
}

export interface CableControls {
    control1: CablePoint;
    control2: CablePoint;
}

/** 冲击波沿卡片外轮廓传播；尺寸、圆角和 padding 均使用世界坐标。 */
export type CableImpactBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius: number;
};

interface CableAxis {
    value: number;
    target: number;
    startedAt: number;
    generator: ReturnType<typeof spring> | null;
}

/** 临时拖线的控制点状态，不包含节点、连接业务或自主调度器。 */
export interface CableMotion {
    control1: { x: CableAxis; y: CableAxis };
    control2: { x: CableAxis; y: CableAxis };
}

export interface CableMotionFrame {
    pathD: string;
    /** false 表示四个控制轴均已静止，调用方可停止逐帧推进。 */
    moving: boolean;
}

/** 均衡档的固定屏幕像素尺寸；SVG 与 Leafer 拖线共用，渲染时分别抵消镜头缩放。 */
export const cableStroke = {
    width: 2,
    halo: 4.5,
    backing: 3,
    highlight: 0.43,
    endpoint: 4,
    endpointHighlight: 1,
    emphasisHalo: 6.5,
    emphasisBlur: 2,
} as const;

/** 连线与接入特效统一青色；浅色画布加深同一色相，保证对比度。 */
export function connectionColor(light = false): string {
    return light ? "#388d93" : "#77d9de";
}

/** 静止线使用水平出入的三次贝塞尔，不在节点两端叠加永久垂坠。 */
export function cableControls(start: CablePoint, end: CablePoint, scale = 1): CableControls {
    const curvature = Math.max(Math.abs(end.x - start.x) * 0.5, 44 / scale);
    return {
        control1: { x: start.x + curvature, y: start.y },
        control2: { x: end.x - curvature, y: end.y },
    };
}

/**
 * SVG 和 Leafer 共用同一条 path；端点始终精确使用本次传入的坐标。
 * 传入控制点只用于拖线惯性，不写入已建立连接的持久化数据。
 */
export function cablePath(start: CablePoint, end: CablePoint, scale = 1, controls = cableControls(start, end, scale)): string {
    const { control1, control2 } = controls;
    return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
}

/**
 * 返回从接入口投影位置出发、方向相反的两条闭合轮廓：顺时针在前，逆时针在后。
 * 调用方按 length / 2 推进两股亮带即可在另一侧汇合；本函数不持有动画状态。
 * pointAt 按真实弧长采样同一轮廓，reverse 为 true 时沿逆时针方向前进。
 * SVG A 由 Leafer 的 PathConvert / EllipseHelper 原生解析，避免用折线近似圆角。
 */
export function cableImpactContour(point: CablePoint, bounds: CableImpactBounds, padding: number): {
    paths: [string, string];
    length: number;
    pointAt: (distance: number, reverse?: boolean) => CablePoint;
} {
    const left = bounds.x - padding;
    const top = bounds.y - padding;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    const right = left + width;
    const bottom = top + height;
    const radius = Math.min(Math.max(0, bounds.cornerRadius + padding), width / 2, height / 2);
    const onLeft = Math.abs(point.x - left) <= Math.abs(point.x - right);
    const origin = {
        x: onLeft ? left : right,
        y: Math.max(top + radius, Math.min(bottom - radius, point.y)),
    };
    // 依顺时针排列每个圆角的进入点、离开点；起始直边只被投影点分成两段。
    const corners = [
        { enter: { x: left, y: top + radius }, exit: { x: left + radius, y: top }, center: { x: left + radius, y: top + radius } },
        { enter: { x: right - radius, y: top }, exit: { x: right, y: top + radius }, center: { x: right - radius, y: top + radius } },
        { enter: { x: right, y: bottom - radius }, exit: { x: right - radius, y: bottom }, center: { x: right - radius, y: bottom - radius } },
        { enter: { x: left + radius, y: bottom }, exit: { x: left, y: bottom - radius }, center: { x: left + radius, y: bottom - radius } },
    ];
    const ordered = onLeft ? corners : [...corners.slice(2), ...corners.slice(0, 2)];
    const length = 2 * (width + height - 4 * radius) + 2 * Math.PI * radius;
    const sections: { start: CablePoint; end: CablePoint; length: number; center?: CablePoint }[] = [];
    let cursor = origin;
    const lineTo = (end: CablePoint) => {
        const distance = Math.hypot(end.x - cursor.x, end.y - cursor.y);
        if (distance > 0) sections.push({ start: cursor, end, length: distance });
        cursor = end;
    };
    for (const corner of ordered) {
        lineTo(corner.enter);
        if (radius > 0) sections.push({ start: corner.enter, end: corner.exit, center: corner.center, length: Math.PI * radius / 2 });
        cursor = corner.exit;
    }
    lineTo(origin);
    const trace = (reverse: boolean): string => {
        const steps = reverse ? [...ordered].reverse() : ordered;
        const segments = steps.map((corner) => {
            const enter = reverse ? corner.exit : corner.enter;
            const exit = reverse ? corner.enter : corner.exit;
            const line = `L ${enter.x} ${enter.y}`;
            // 直角轮廓不输出 A 0，避免椭圆弧解析器出现除零。
            return radius > 0 ? `${line} A ${radius} ${radius} 0 0 ${reverse ? 0 : 1} ${exit.x} ${exit.y}` : line;
        });
        return `M ${origin.x} ${origin.y} ${segments.join(" ")} Z`;
    };
    return {
        paths: [trace(false), trace(true)],
        length,
        pointAt(distance, reverse = false) {
            const clamped = Math.max(0, Math.min(length, distance));
            if (clamped === 0 || clamped === length) return { ...origin };
            let remaining = reverse ? length - clamped : clamped;
            for (const section of sections) {
                if (remaining <= section.length) {
                    if (section.center) {
                        const angle = Math.atan2(section.start.y - section.center.y, section.start.x - section.center.x) + remaining / radius;
                        return {
                            x: section.center.x + Math.cos(angle) * radius,
                            y: section.center.y + Math.sin(angle) * radius,
                        };
                    }
                    const progress = remaining / section.length;
                    return {
                        x: section.start.x + (section.end.x - section.start.x) * progress,
                        y: section.start.y + (section.end.y - section.start.y) * progress,
                    };
                }
                remaining -= section.length;
            }
            // 整周累计的浮点误差仍闭合到同一接入口。
            return { ...origin };
        },
    };
}

/** 创建时控制点即位；无需首帧从原点飞入，也不创建计时器或 RAF。 */
export function createCableMotion(start: CablePoint, end: CablePoint, scale = 1, nowMs = 0): CableMotion {
    const { control1, control2 } = cableControls(start, end, scale);
    const axis = (value: number): CableAxis => ({ value, target: value, startedAt: nowMs, generator: null });
    return {
        control1: { x: axis(control1.x), y: axis(control1.y) },
        control2: { x: axis(control2.x), y: axis(control2.y) },
    };
}

/**
 * nowMs 由调用方传入单调递增的毫秒时间（例如 RAF 的时间戳）。
 * Motion 解析弹簧负责位置、速度与收敛，重定向继承当前速度，避免自行积分和掉帧发散。
 * 鼠标端点没有弹簧延迟；只有线身控制点滞后。结束拖线时直接丢弃此状态。
 */
export function advanceCableMotion(state: CableMotion, start: CablePoint, end: CablePoint, nowMs: number, scale = 1): CableMotionFrame {
    const target = cableControls(start, end, scale);
    const control1 = {
        x: advanceAxis(state.control1.x, target.control1.x, nowMs, scale),
        y: advanceAxis(state.control1.y, target.control1.y, nowMs, scale),
    };
    const control2 = {
        x: advanceAxis(state.control2.x, target.control2.x, nowMs, scale),
        y: advanceAxis(state.control2.y, target.control2.y, nowMs, scale),
    };
    return {
        pathD: cablePath(start, end, scale, { control1, control2 }),
        moving: Boolean(state.control1.x.generator || state.control1.y.generator || state.control2.x.generator || state.control2.y.generator),
    };
}

function advanceAxis(axis: CableAxis, target: number, nowMs: number, scale: number): number {
    let velocity = 0;
    if (axis.generator) {
        const elapsed = nowMs - axis.startedAt;
        const sample = axis.generator.next(elapsed);
        axis.value = sample.value;
        if (sample.done) {
            axis.generator = null;
        } else {
            // 当前 Motion spring 暴露解析速度，单位为世界坐标/秒。
            velocity = axis.generator.velocity!(elapsed);
        }
    }
    if (target !== axis.target) {
        axis.target = target;
        axis.startedAt = nowMs;
        axis.generator = spring({
            keyframes: [axis.value, target],
            velocity,
            stiffness: 180,
            damping: 20,
            mass: 0.85,
            restDelta: 0.15 / scale,
            restSpeed: 8 / scale,
        });
    }
    return axis.value;
}
