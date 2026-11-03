import type { CanvasNodeData, Position } from "@/types/canvas";

export type CanvasConnectionApproach = { nodeId: string; point: Position } | null;

/** 同一目标内也记录最新线头位置；控制器已将指针更新合并到每帧一次。 */
export function latchCanvasConnectionApproach(previous: CanvasConnectionApproach, nodeId: string | null, point: Position): CanvasConnectionApproach {
    if (!nodeId) return null;
    if (previous?.nodeId === nodeId && previous.point.x === point.x && previous.point.y === point.y) return previous;
    return { nodeId, point: { ...point } };
}

/** 只用于卡片显示层的临时反馈，不写节点坐标，不改变实际连线锚点。 */
export function canvasConnectionTilt(node: Pick<CanvasNodeData, "position" | "width" | "height">, point?: Position) {
    if (!point || node.width <= 0 || node.height <= 0) return undefined;
    const x = Math.max(-1, Math.min(1, (point.x - node.position.x) / node.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (point.y - node.position.y) / node.height * 2 - 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x: x * 2.5, y: y * 3.5, z: 22, rotateX: -y * 5, rotateY: x * 5, rotateZ: -x * 0.3, scale: 1.024 };
}

export type CanvasConnectionTilt = ReturnType<typeof canvasConnectionTilt>;
