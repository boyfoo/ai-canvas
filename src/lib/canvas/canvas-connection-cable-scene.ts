import { Ellipse, Group, Path } from "leafer-ui";

import { advanceCableMotion, cableImpactContour, cableImpactOffset, cablePath, cableStroke, createCableMotion, type CableImpactBounds, type CableMotion, type CablePoint } from "./canvas-connection-cable";
import { CanvasConnectionPortEffect, type CanvasPortEffectStyle } from "./canvas-connection-port-effect";
import type { CanvasConnectionImpactFeedback } from "./canvas-live-viewport";

/** 只接收绘制坐标与合法目标；是否允许连接仍由原连接控制器决定。 */
export type CanvasCableDraft = {
    id: string;
    start: CablePoint;
    end: CablePoint;
    freeEnd: "start" | "end";
    target?: CablePoint & { nodeWidth: number };
    color: string;
    ink: string;
};

type CableTrack = {
    input: CanvasCableDraft;
    group: Group;
    halo: Path;
    body: Path;
    highlight: Path;
    plugs: Path;
    portEffect: CanvasConnectionPortEffect;
    portStartedAt: number | null;
    portTargetKey: string | null;
    arcs: Path[];
    arcCores: Path[];
    motion: CableMotion;
};

type ImpactBranch = { glow: Path; tail: Path; head: Path; light: Ellipse; wake: Ellipse };
type CableFlash = { point: CablePoint; bounds: CableImpactBounds; side: "left" | "right"; feedback: CanvasConnectionImpactFeedback | null; color: string; startedAt: number | null; group: Group; portEffect: CanvasConnectionPortEffect; branches: ImpactBranch[] };

/**
 * 临时线缆的 Leafer 绘制器。复用现有 world 和 DPR，不创建第二个画布。
 * 端点实时跟随，Motion 只推进线身；静止且没有电弧时停止 RAF。
 * 无节点数据写入、命中处理或模型请求，销毁时统一释放帧与场景节点。
 */
export class CanvasConnectionCableScene {
    private tracks = new Map<string, CableTrack>();
    private frame: number | null = null;
    private scale = 1;
    private reducedMotion = false;
    private effectStyle: CanvasPortEffectStyle = "wave";
    private destroyed = false;
    private flashes: CableFlash[] = [];

    constructor(private readonly parent: Group, private readonly host: HTMLDivElement, private readonly render: () => void) {}

    /** 有临时线缆／光圈时同步镜头预览，确保图形与节点使用同一倍率。 */
    get hasContent() {
        return this.tracks.size > 0 || this.flashes.length > 0;
    }

    sync(inputs: CanvasCableDraft[], scale: number, reducedMotion: boolean, effectStyle: CanvasPortEffectStyle) {
        this.scale = Math.max(scale, 0.05);
        this.reducedMotion = reducedMotion;
        this.effectStyle = effectStyle;
        if (inputs.some((input) => !this.tracks.has(input.id))) this.cancelImpacts();
        const ids = new Set(inputs.map((input) => input.id));
        for (const [id, track] of this.tracks) {
            if (ids.has(id)) continue;
            track.group.destroy();
            this.tracks.delete(id);
        }
        const now = performance.now();
        for (const input of inputs) {
            const track = this.tracks.get(input.id);
            if (track) {
                track.input = input;
            }
            else this.tracks.set(input.id, this.createTrack(input, now));
        }
        this.host.dataset.canvasCableCount = String(inputs.length);
        this.draw(now);
    }

    setScale(scale: number) {
        this.scale = Math.max(scale, 0.05);
        this.draw(performance.now());
    }

    /** 只由真实新增连接触发，取消、非法目标与页面初次加载不能调用。 */
    flash(point: CablePoint, color: string, bounds: CableImpactBounds, feedback: CanvasConnectionImpactFeedback | null) {
        if (this.destroyed || this.reducedMotion || this.host.closest(".no-motion")) {
            feedback?.finish();
            return;
        }
        // 一个目标只保留本次受力；旧会话释放时不会清掉已经接管的新预览。
        if (feedback) this.flashes = this.flashes.filter((flash) => {
            if (flash.feedback?.nodeId !== feedback.nodeId) return true;
            destroyFlash(flash);
            return false;
        });
        const group = new Group({ hittable: false });
        this.parent.add(group);
        const portEffect = new CanvasConnectionPortEffect(group);
        const branches = Array.from({ length: 2 }, () => {
            const options = { hittable: false, visible: false, strokeCap: "round" as const, strokeJoin: "round" as const };
            const branch = {
                glow: new Path(options), tail: new Path(options), head: new Path(options),
                light: new Ellipse({ hittable: false, visible: false, fill: lightFill(color, 0.75) }),
                wake: new Ellipse({ hittable: false, visible: false, fill: lightFill(color, 0.3) }),
            };
            group.add(branch.wake);
            group.add(branch.light);
            group.add(branch.glow);
            group.add(branch.tail);
            group.add(branch.head);
            return branch;
        });
        const side = Math.abs(point.x - bounds.x) <= Math.abs(point.x - bounds.x - bounds.width) ? "left" : "right";
        this.flashes.push({ point, bounds, side, feedback, color, startedAt: null, group, portEffect, branches });
        this.draw(performance.now());
    }

    /** 真实拖动／新接线优先，先归还节点与 SVG 的临时几何再处理新的操作。 */
    cancelImpacts() {
        if (!this.flashes.length) return;
        const flashes = this.flashes;
        this.flashes = [];
        flashes.forEach(destroyFlash);
        this.draw(performance.now());
        this.render();
    }

    destroy() {
        this.destroyed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        for (const track of this.tracks.values()) track.group.destroy();
        this.tracks.clear();
        this.flashes.forEach(destroyFlash);
        this.flashes = [];
        delete this.host.dataset.canvasCableCount;
        delete this.host.dataset.canvasCableAnimating;
    }

    private createTrack(input: CanvasCableDraft, now: number): CableTrack {
        const group = new Group({ hittable: false });
        const halo = new Path({ hittable: false, strokeCap: "round" });
        const body = new Path({ hittable: false, strokeCap: "round" });
        const highlight = new Path({ hittable: false, strokeCap: "round" });
        const plugs = new Path({ hittable: false, strokeCap: "round" });
        const arcs = Array.from({ length: 2 }, () => new Path({ hittable: false, visible: false, strokeCap: "round", strokeJoin: "round" }));
        const arcCores = Array.from({ length: 2 }, () => new Path({ hittable: false, visible: false, strokeCap: "round", strokeJoin: "round" }));
        group.add(halo);
        group.add(body);
        group.add(highlight);
        arcs.forEach((arc) => group.add(arc));
        arcCores.forEach((arc) => group.add(arc));
        group.add(plugs);
        const portEffect = new CanvasConnectionPortEffect(group);
        this.parent.add(group);
        return { input, group, halo, body, highlight, plugs, portEffect, portStartedAt: null, portTargetKey: null, arcs, arcCores, motion: createCableMotion(input.start, input.end, this.scale, now) };
    }

    private draw = (now: number, animationFrame = false) => {
        if (this.destroyed) return;
        // 同步更新保留已排队的首帧，连续缩放也不能反复推迟成功反馈的启动。
        if (animationFrame) this.frame = null;
        let animating = false;
        const hadImpacts = this.flashes.length > 0;
        const scale = this.scale;
        const reducedMotion = this.reducedMotion || Boolean(this.host.closest(".no-motion"));
        for (const track of this.tracks.values()) {
            const { input } = track;
            const pointer = input.freeEnd === "end" ? input.end : input.start;
            const distance = input.target ? Math.hypot(pointer.x - input.target.x, pointer.y - input.target.y) * scale : Infinity;
            // 整框接线保持不变；电弧仅出现在真正靠近端口的短距离，不能跨整个节点闪电。
            const nearPort = Boolean(input.target && distance < 58);
            let tip = pointer;
            if (nearPort && input.target && distance > 0) {
                // 线头保留在鼠标附近，只轻轻吸近端口，并留出能看清电弧的间隙。
                const pull = Math.max(0, 1 - distance / 58) * 0.28;
                tip = { x: pointer.x + (input.target.x - pointer.x) * pull, y: pointer.y + (input.target.y - pointer.y) * pull };
            }
            const start = input.freeEnd === "start" ? tip : input.start;
            const end = input.freeEnd === "end" ? tip : input.end;
            const frame = reducedMotion
                ? { pathD: cablePath(start, end, scale), moving: false }
                : advanceCableMotion(track.motion, start, end, now, scale);
            animating ||= frame.moving;
            const stroke = input.ink;
            track.halo.set({ path: frame.pathD, stroke, strokeWidth: cableStroke.halo / scale, opacity: 0.08 });
            track.body.set({ path: frame.pathD, stroke, strokeWidth: cableStroke.width / scale, opacity: 0.92 });
            track.highlight.set({ path: frame.pathD, stroke: "#ffffff", strokeWidth: cableStroke.highlight / scale, opacity: 0.38 });
            track.plugs.set({ path: `M ${start.x} ${start.y} l 0 0 M ${end.x} ${end.y} l 0 0`, stroke, strokeWidth: cableStroke.endpoint / scale });
            track.arcs.forEach((arc) => { arc.visible = nearPort && !reducedMotion; });
            track.arcCores.forEach((arc) => { arc.visible = nearPort && !reducedMotion; });
            if (!nearPort || !input.target) {
                track.portEffect.hide();
                track.portStartedAt = null;
                track.portTargetKey = null;
                continue;
            }
            const pulse = reducedMotion ? 0.6 : 0.7 + Math.sin(now * 0.016) * 0.18;
            const targetKey = `${input.target.x}:${input.target.y}:${input.target.nodeWidth}:${this.effectStyle}`;
            if (track.portStartedAt === null || track.portTargetKey !== targetKey) {
                track.portStartedAt = now;
                track.portTargetKey = targetKey;
            }
            track.portEffect.draw({ point: input.target, nodeWidth: input.target.nodeWidth, side: input.freeEnd === "end" ? "left" : "right", color: input.color, dotColor: input.ink, style: this.effectStyle, elapsed: now - track.portStartedAt, success: false, reducedMotion });
            if (reducedMotion) continue;
            animating = true;
            for (let index = 0; index < track.arcs.length; index += 1) {
                const path = electricArc(tip, input.target, scale, now, index);
                track.arcs[index].set({ path, stroke: input.color, strokeWidth: (index === 0 ? 2.2 : 1.4) / scale, opacity: (index === 0 ? 0.85 : 0.45) * pulse, shadow: { x: 0, y: 0, blur: 5 / scale, color: input.color } });
                track.arcCores[index].set({ path, stroke: "#ffffff", strokeWidth: 0.7 / scale, opacity: (index === 0 ? 0.9 : 0.4) * pulse });
            }
        }
        this.flashes = this.flashes.filter((flash) => {
            // 从提交后的首个动画帧计时，避免节点／媒体更新先耗完短促的接入反馈。
            if (flash.startedAt === null && animationFrame) flash.startedAt = now;
            const elapsed = flash.startedAt === null ? 0 : now - flash.startedAt;
            const progress = elapsed / 650;
            if (progress >= 1 || reducedMotion) {
                destroyFlash(flash);
                return false;
            }
            // 一份 elapsed 同帧驱动整节点、SVG 接线及光波；位移始终使用世界坐标。
            const offset = flash.feedback ? cableImpactOffset(elapsed, flash.bounds.width, flash.side) : { x: 0, y: 0 };
            if (flash.feedback && !flash.feedback.update(offset)) {
                destroyFlash(flash);
                return false;
            }
            flash.group.set({ x: offset.x, y: offset.y });
            // 靠近与成功共用所选接点材质；同一 elapsed 驱动，650ms 内完成扩散与淡出。
            flash.portEffect.draw({ point: flash.point, nodeWidth: flash.bounds.width, side: flash.side, color: flash.color, dotColor: flash.color, style: this.effectStyle, elapsed, success: true, reducedMotion });

            // 参考里的冲击波沿目标的圆角边框分成两股传播，不是扩大端口圆圈。
            // 仅向外偏移一个屏幕像素，让现有节点覆盖层也能清楚看到边缘亮带。
            const contour = cableImpactContour(flash.point, flash.bounds, 1 / scale);
            const phase = Math.min(1, progress / 0.88);
            const distance = contour.length / 2 * phase;
            const tailLength = Math.min(92 / scale, contour.length * 0.18);
            const headLength = Math.min(28 / scale, tailLength * 0.4);
            const fadeOut = Math.max(0, Math.min(1, (progress - 0.68) / 0.32));
            const fade = Math.min(1, elapsed / 24) * (1 - fadeOut * fadeOut * (3 - 2 * fadeOut));
            flash.branches.forEach((branch, index) => {
                const common = { visible: true, path: contour.paths[index], dashPattern: [tailLength, contour.length * 2], dashOffset: tailLength - distance };
                // 光斑负责卡片内外的柔和染色；描边只保留细亮边，不画均匀白色硬条。
                branch.glow.set({ ...common, stroke: flash.color, strokeWidth: 1 / scale, opacity: 0.5 * fade, shadow: { x: 0, y: 0, blur: 14 / scale, color: flash.color } });
                branch.tail.set({ ...common, stroke: flash.color, strokeWidth: 1.2 / scale, opacity: 0.32 * fade });
                branch.head.set({ ...common, dashPattern: [headLength, contour.length * 2], dashOffset: headLength - distance, stroke: flash.color, strokeWidth: 2.2 / scale, opacity: 0.92 * fade, shadow: { x: 0, y: 0, blur: 6 / scale, color: flash.color } });
                const front = contour.pointAt(Math.max(0, distance - headLength * 0.35), index === 1);
                const wake = contour.pointAt(Math.max(0, distance - tailLength * 0.55), index === 1);
                branch.light.set({ visible: true, x: front.x - 32 / scale, y: front.y - 32 / scale, width: 64 / scale, height: 64 / scale, opacity: 0.8 * fade });
                branch.wake.set({ visible: true, x: wake.x - 42 / scale, y: wake.y - 42 / scale, width: 84 / scale, height: 84 / scale, opacity: 0.65 * fade });
            });
            animating = true;
            return true;
        });
        // Leafer 与 DOM/SVG 在本次绘制中一起提交，避免光波晚一帧才跟上节点。
        if (hadImpacts) this.render();
        this.host.dataset.canvasCableAnimating = animating ? "true" : "false";
        if (animating && !reducedMotion) {
            // 与 sync/setScale 使用同一实际时刻；繁忙帧较早的 rAF 时间戳会跳过起势。
            if (this.frame === null) this.frame = requestAnimationFrame(() => this.draw(performance.now(), true));
        }
        else if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
    };
}

function destroyFlash(flash: CableFlash) {
    flash.group.destroy();
    flash.feedback?.finish();
}

/** 复用 Leafer 的径向渐变，透明外缘形成真实光照衰减，避免靠宽描边堆出色块。 */
function lightFill(color: string, strength: number) {
    // connectionColor 固定返回 #RRGGBB；直接使用原生八位十六进制颜色，
    // 不依赖 Leafer 仅有类型声明、当前发行包未注册的 ColorConvert.object。
    const withAlpha = (alpha: number) => `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
    return {
        type: "radial" as const,
        stops: [
            { offset: 0, color: withAlpha(strength) },
            { offset: 0.18, color: withAlpha(strength * 0.65) },
            { offset: 0.5, color: withAlpha(strength * 0.18) },
            { offset: 1, color: withAlpha(0) },
        ],
    };
}

/** 两端固定、内部沿法线偏移的短电弧；分段噪声只在局部刷新，避免整条线抖动。 */
function electricArc(start: CablePoint, end: CablePoint, scale: number, now: number, branch: number) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const inverseLength = length > 0 ? 1 / length : 0;
    const nx = -dy * inverseLength;
    const ny = dx * inverseLength;
    const tick = Math.floor(now / 45);
    const amplitude = Math.min(4 / scale, length * 0.2);
    let path = `M ${start.x} ${start.y}`;
    for (let index = 1; index < 7; index += 1) {
        const t = index / 7;
        const noise = Math.sin((tick * 31.17 + index * 17.37 + branch * 73.71)) * Math.cos(tick * 7.13 + index * 4.91);
        const offset = noise * amplitude * Math.sin(t * Math.PI);
        path += ` L ${start.x + dx * t + nx * offset} ${start.y + dy * t + ny * offset}`;
    }
    return `${path} L ${end.x} ${end.y}`;
}
