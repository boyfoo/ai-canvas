import { Ellipse, Group, Path } from "leafer-ui";

import type { CablePoint } from "./canvas-connection-cable";

/** 四种接点材质共用原接线时钟与世界坐标，不改变连接判定或节点数据。 */
export type CanvasPortEffectStyle = "wave" | "breath" | "haze" | "edge";

export const canvasPortEffectOptions = [
    { value: "wave", label: "细光波外扩", description: "细线从接点向外散开，中心透空" },
    { value: "breath", label: "边缘呼吸", description: "一道薄环轻微呼吸，边缘柔和亮起" },
    { value: "haze", label: "柔光晕扩散", description: "没有硬轮廓的环形柔光向外扩散" },
    { value: "edge", label: "沿边聚光", description: "不画完整圆圈，光沿节点边缘上下铺开" },
] as const satisfies ReadonlyArray<{ value: CanvasPortEffectStyle; label: string; description: string }>;

type CanvasPortEffectInput = {
    point: CablePoint;
    nodeWidth: number;
    side: "left" | "right";
    color: string;
    dotColor: string;
    style: CanvasPortEffectStyle;
    /** 靠近时为进入合法接点后的时间，成功时为场景的同一份 elapsed。 */
    elapsed: number;
    success: boolean;
    reducedMotion: boolean;
};

const periods: Record<CanvasPortEffectStyle, number> = { wave: 800, breath: 1400, haze: 900, edge: 650 };

/**
 * 接点效果绘制器。外围只描边，唯一填充图形是小实心点，避免半透明圆盘。
 * 不自行调度 RAF；调用方统一推进、隐藏，并随所属 Group 销毁。
 */
export class CanvasConnectionPortEffect {
    private readonly group = new Group({ hittable: false, visible: false });
    private readonly glow = new Path({ hittable: false, strokeCap: "round", strokeJoin: "round" });
    private readonly body = new Path({ hittable: false, strokeCap: "round", strokeJoin: "round" });
    private readonly dot = new Ellipse({ hittable: false });

    constructor(parent: Group) {
        this.group.add(this.glow);
        this.group.add(this.body);
        this.group.add(this.dot);
        parent.add(this.group);
    }

    hide() {
        this.group.visible = false;
    }

    draw(input: CanvasPortEffectInput) {
        const { point, nodeWidth, color, dotColor, style, elapsed, success, reducedMotion } = input;
        const diameter = nodeWidth * 0.09;
        const progress = success ? Math.min(1, Math.max(0, elapsed / 650)) : reducedMotion ? 0.34 : (elapsed % periods[style]) / periods[style];
        const eased = 1 - (1 - progress) ** 3;
        const fade = success ? (1 - progress) ** 0.7 : 1;
        let radius = diameter * 0.5;
        let strokeWidth = diameter * 0.025;
        let opacity = fade;
        let glowWidth = diameter * 0.065;
        let glowOpacity = fade * 0.12;
        let glowBlur = diameter * 0.035;

        this.group.visible = true;
        if (style === "wave") {
            radius = diameter * (0.18 + 0.64 * eased);
            opacity *= 0.72 * (1 - progress) ** 1.25;
            glowOpacity = opacity * 0.18;
        } else if (style === "breath") {
            const pulse = Math.sin(progress * Math.PI);
            radius = diameter * (0.45 + pulse * 0.05);
            opacity *= 0.25 + 0.55 * pulse;
            glowWidth = diameter * 0.09;
            glowOpacity = opacity * 0.22;
            glowBlur = diameter * 0.05;
        } else if (style === "haze") {
            radius = diameter * (0.27 + 0.5 * eased);
            opacity *= 0.62 * (1 - progress) ** 1.1;
            strokeWidth = diameter * 0.055;
            glowWidth = diameter * 0.115;
            glowOpacity = opacity * 0.7;
            glowBlur = diameter * 0.065;
        }

        if (style === "edge") {
            const pulse = Math.sin(progress * Math.PI);
            const reach = diameter * (0.23 + 0.84 * eased);
            // 光落在接入边缘；从右侧接入时的细偏移同样向节点内部。
            const x = point.x + (input.side === "left" ? 1 : -1) * diameter * 0.012;
            // 局部路径配合方向关键字按包围盒渐变；普通 { x, y } 是像素而非百分比。
            const path = `M 0 0 L 0 ${reach * 2}`;
            const edgeFill = {
                type: "linear" as const,
                from: "top" as const, to: "bottom" as const,
                stops: [
                    { offset: 0, color: `${color}00` },
                    { offset: 0.34, color },
                    { offset: 0.66, color },
                    { offset: 1, color: `${color}00` },
                ],
            };
            this.glow.set({ x, y: point.y - reach, path, stroke: edgeFill, strokeWidth: diameter * 0.16, opacity: pulse * fade * 0.25, blur: diameter * 0.07 });
            this.body.set({ x, y: point.y - reach, path, stroke: edgeFill, strokeWidth: diameter * 0.028, opacity: pulse * fade * 0.75, blur: 0 });
        } else {
            const path = circlePath(point, radius);
            this.glow.set({ x: 0, y: 0, path, stroke: color, strokeWidth: glowWidth, opacity: glowOpacity, blur: glowBlur });
            // 柔光晕本体也做轻度模糊，避免形成第二道硬轮廓。
            this.body.set({ x: 0, y: 0, path, stroke: color, strokeWidth, opacity: style === "haze" ? opacity * 0.26 : opacity, blur: style === "haze" ? diameter * 0.027 : 0 });
        }

        const dotSize = diameter * 0.24;
        this.dot.set({ x: point.x - dotSize / 2, y: point.y - dotSize / 2, width: dotSize, height: dotSize, fill: dotColor, opacity: success ? (1 - progress) ** 0.7 : 1 });
    }
}

function circlePath(point: CablePoint, radius: number) {
    return `M ${point.x + radius} ${point.y} A ${radius} ${radius} 0 1 0 ${point.x - radius} ${point.y} A ${radius} ${radius} 0 1 0 ${point.x + radius} ${point.y} Z`;
}
