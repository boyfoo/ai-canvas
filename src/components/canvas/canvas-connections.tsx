import React, { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { CanvasConnectionShuttle } from "@/components/canvas/canvas-connection-shuttle";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { cablePath, cableStroke, connectionColor } from "@/lib/canvas/canvas-connection-cable";
import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { batchReferenceHandleY } from "@/lib/canvas/canvas-batch-table";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

function ConnectionPathView({
    connection,
    from,
    to,
    fromScrollTop = 0,
    toScrollTop = 0,
    selected,
    related = false,
    visualMode = "full",
    hideVisual = false,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    fromScrollTop?: number;
    toScrollTop?: number;
    selected: boolean;
    /** 单选节点的直接邻边，与直接选中连线分开表达。 */
    related?: boolean;
    visualMode?: "full" | "hover-only";
    hideVisual?: boolean;
    onSelect: (connectionId: string) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
}) {
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const [hovered, setHovered] = useState(false);
    const { pathD, startX, startY, endX, endY } = canvasConnectionPath(connection, from, to, fromScrollTop, toScrollTop);
    const emphasized = selected || related || hovered;
    // 只读稠密 LibTV 总览保留原有低对比虚线，不套用交互画布的彩色线缆。
    const denseReadonlyWire = connection.id.startsWith("libtv-dense-");
    const showVisual = shouldShowConnectionVisual({ visualMode, hovered, hideVisual });
    const light = themeName === "light";
    // 常态退到背景，选中节点只适度突出邻边；直接选中连线才使用完整强调。
    // 透明度落在各描边自身，平移/缩放仅保留主线时也不会突然变亮。
    const state = selected ? "selected" : hovered ? "hovered" : related ? "related" : "idle";
    const color = selected || related ? connectionColor(light) : theme.node.text;
    // 选中线须高于悬停的视觉强度，短光梭再提供局部的亮度差。
    const lineOpacity = selected ? 0.85 : hovered ? 0.56 : related ? 0.46 : light ? 0.2 : 0.16;
    const highlightOpacity = !selected && related ? 0.08 : 0;
    // 直接选中仅由短光梭强调，悬停的轻外晕不叠加到选中态。
    const showHoverHalo = showVisual && hovered && !selected && !denseReadonlyWire;
    const endpointsD = `M ${startX} ${startY} l 0 0 M ${endX} ${endY} l 0 0`;

    return (
        <g data-canvas-connection-id={connection.id} data-connection-state={state}>
            {/* 模糊仅用于未选中连线的悬停；选中态保留清晰线身与局部流光。 */}
            {showHoverHalo ? <path
                d={pathD}
                stroke={color}
                strokeWidth={cableStroke.emphasisHalo}
                strokeOpacity={0.07}
                vectorEffect="non-scaling-stroke"
                fill="none"
                strokeLinecap="round"
                style={{ pointerEvents: "none", strokeWidth: `calc(${cableStroke.emphasisHalo}px * var(--canvas-wire-inverse-scale, 1))`, filter: `blur(calc(${cableStroke.emphasisBlur}px * var(--canvas-wire-inverse-scale, 1)))` }}
            /> : null}
            {/* 命中仍为独立的屏幕 16px 透明描边，视觉厚度不改变选择和右键操作。 */}
            <path
                data-connection-id={connection.id}
                data-connection-active={selected ? "true" : "false"}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke", strokeWidth: denseReadonlyWire ? undefined : "calc(16px * var(--canvas-wire-inverse-scale, 1))" }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect(connection.id);
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event, connection.id);
                }}
            />
            {showHoverHalo ? <path
                d={pathD}
                stroke={color}
                strokeWidth={cableStroke.hoverHalo}
                strokeOpacity={0.05}
                vectorEffect="non-scaling-stroke"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ pointerEvents: "none", strokeWidth: `calc(${cableStroke.hoverHalo}px * var(--canvas-wire-inverse-scale, 1))` }}
            /> : null}
            {showVisual ? <path
                d={pathD}
                stroke={denseReadonlyWire ? theme.node.muted : theme.canvas.background}
                strokeWidth={denseReadonlyWire ? 0.75 : cableStroke.backing}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={denseReadonlyWire ? 0.12 : selected ? 0.8 : emphasized ? 0.5 : 0.3}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={denseReadonlyWire ? "2 12" : undefined}
                style={{ pointerEvents: "none", strokeWidth: denseReadonlyWire ? undefined : `calc(${cableStroke.backing}px * var(--canvas-wire-inverse-scale, 1))` }}
            /> : null}
            {/* 保留主线 class：平移/缩放时已有性能规则仅绘制这一层。 */}
            {showVisual ? <path
                className="canvas-connection-line"
                d={pathD}
                stroke={denseReadonlyWire ? emphasized ? theme.accent.primary : theme.node.muted : color}
                strokeWidth={denseReadonlyWire ? 0.75 : cableStroke.width}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={denseReadonlyWire ? 0.16 : lineOpacity}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={denseReadonlyWire ? "2 12" : undefined}
                style={{ pointerEvents: "none", strokeWidth: denseReadonlyWire ? undefined : `calc(${cableStroke.width}px * var(--canvas-wire-inverse-scale, 1))` }}
            /> : null}
            {showVisual && !denseReadonlyWire ? <>
                <path
                    d={pathD}
                    stroke="white"
                    strokeWidth={cableStroke.highlight}
                    strokeOpacity={highlightOpacity}
                    vectorEffect="non-scaling-stroke"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: "none", strokeWidth: `calc(${cableStroke.highlight}px * var(--canvas-wire-inverse-scale, 1))` }}
                />
                {/* 零长圆头描边形成端点圆点：继承逆倍率抵消外层 CSS 缩放，vectorEffect 保留 SVG 内部缩放保护。
                    拖动预览按此属性更新端点，不能把短 path 替换成整条连线路径。 */}
                <path data-canvas-cable-endpoints d={endpointsD} stroke={color} strokeWidth={cableStroke.endpoint} strokeOpacity={lineOpacity} vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" style={{ pointerEvents: "none", strokeWidth: `calc(${cableStroke.endpoint}px * var(--canvas-wire-inverse-scale, 1))` }} />
                <path data-canvas-cable-endpoints d={endpointsD} stroke="white" strokeWidth={cableStroke.endpointHighlight} strokeOpacity={!selected && related ? 0.18 : 0} vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" style={{ pointerEvents: "none", strokeWidth: `calc(${cableStroke.endpointHighlight}px * var(--canvas-wire-inverse-scale, 1))` }} />
            </> : null}
            {showVisual && selected && !denseReadonlyWire ? (
                <CanvasConnectionShuttle pathD={pathD} color={light ? "#12535c" : "#ecffff"} />
            ) : null}
            {showVisual && denseReadonlyWire ? <>
                <circle cx={startX} cy={startY} r={0.35} fill={emphasized ? theme.accent.primary : theme.node.muted} fillOpacity={0.12} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                <circle cx={endX} cy={endY} r={0.35} fill={emphasized ? theme.accent.primary : theme.node.muted} fillOpacity={0.12} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            </> : null}
        </g>
    );
}

// 由调用方传入稳定事件函数，标准浅比较即可覆盖全部视觉状态与处理器。
// 不再手动挑选 props，避免扩展状态或替换事件后继续复用旧的连线显示/回调。
export const ConnectionPath = React.memo(ConnectionPathView);

export function canvasConnectionPath(connection: CanvasConnection, from: CanvasNodeData, to: CanvasNodeData, fromScrollTop = 0, toScrollTop = 0) {
    if (connection.pathD) return { pathD: connection.pathD, startX: from.position.x + from.width, startY: from.position.y + from.height / 2, endX: to.position.x, endY: to.position.y + to.height / 2 };
    const startX = from.position.x + from.width;
    const startY = connectionHandleY(from, connection.fromHandleId, fromScrollTop);
    const endX = to.position.x;
    const endY = connectionHandleY(to, connection.toHandleId, toScrollTop);
    return { pathD: cablePath({ x: startX, y: startY }, { x: endX, y: endY }), startX, startY, endX, endY };
}

export function shouldShowConnectionVisual({ visualMode, hovered, hideVisual }: { visualMode: "full" | "hover-only"; hovered: boolean; hideVisual: boolean }) {
    return !hideVisual && (visualMode === "full" || hovered);
}

export function activeConnectionPath(node: CanvasNodeData | undefined, handle: ConnectionHandle, mouseWorld: Position, target?: CanvasNodeData, nodeScrollTop = 0, targetHandleId?: string, targetScrollTop = 0) {
    if (!node) return "";
    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? connectionHandleY(node, handle.handleId, nodeScrollTop) : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : connectionHandleY(node, handle.handleId, nodeScrollTop);
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? connectionHandleY(target, targetHandleId, targetScrollTop) : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? connectionHandleY(target, targetHandleId, targetScrollTop) : endY;
    return cablePath({ x: snappedStartX, y: snappedStartY }, { x: snappedEndX, y: snappedEndY });
}

/**
 * 连线在节点上的接入 Y。
 *
 * 单端口的一侧（左右各一个出入口，除分镜脚本外都是）**永远取边的正中**：
 * 之前按鼠标落点比例取 Y，多条线接同一个端口就会沿着边散开，视觉上像节点有很多端口。
 * 真正的多端口只存在于分镜脚本的 `row:` 句柄；普通节点始终连接到边缘
 * 垂直中心，避免同一个节点因鼠标落点产生漂移的“伪端口”。
 */
export function connectionHandleY(node: CanvasNodeData, handleId?: string, scrollTop = 0) {
    const batchY = batchReferenceHandleY(node, handleId);
    if (batchY !== undefined) return batchY;
    if (handleId === "storyboard:context") return node.position.y + node.height - (node.metadata?.storyboardComposerHeight || 104) / 2;
    if (!handleId?.startsWith("row:")) return node.position.y + node.height / 2;
    const rowId = handleId.slice(4);
    const index = (node.metadata?.storyboard?.rows || []).findIndex((row) => row.id === rowId);
    if (index < 0) return node.position.y + node.height / 2;
    const tableHeight = storyboardTableHeight(node.height, node.metadata?.storyboardComposerHeight);
    const localY = Math.min(Math.max(index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop, 4), tableHeight - 4);
    return node.position.y + STORYBOARD_HEADER_HEIGHT + localY;
}
