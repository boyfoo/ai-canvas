import { useLayoutEffect, useRef, type RefObject } from "react";
import { Group, Leafer, Path, Rect } from "leafer-ui";
import { useReducedMotion } from "motion/react";

import { connectionHandleY } from "@/components/canvas/canvas-connections";
import { prepareCanvasConnectionImpact } from "@/components/canvas/use-canvas-connection-feedback";
import { connectionColor } from "@/lib/canvas/canvas-connection-cable";
import { CanvasConnectionCableScene, type CanvasCableDraft } from "@/lib/canvas/canvas-connection-cable-scene";
import type { CanvasPortEffectStyle } from "@/lib/canvas/canvas-connection-port-effect";
import type { CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview, subscribeCanvasSelectionPreview, type CanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { calculateCanvasPreviewTransform, sameCanvasViewport, shouldRebaseCanvasRaster } from "@/lib/canvas/canvas-leafer-viewport";
import { offsetSelectedNodeBounds } from "@/lib/canvas/canvas-selection";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position, SelectionBox, ViewportTransform } from "@/types/canvas";

type NodeBounds = { left: number; top: number; width: number; height: number; count: number } | null;

type CanvasLeaferGraphicsLayerProps = {
    containerRef: RefObject<HTMLDivElement | null>;
    projectId: string;
    /** 释放和冲击的目标需持续保留 DOM，避免 LOD 在接触前移除反馈宿主。 */
    onConnectionFeedbackNodesChange: (nodeIds: ReadonlySet<string>) => void;
    viewport: ViewportTransform;
    theme: CanvasTheme;
    connectionPortEffect: CanvasPortEffectStyle;
    scriptScrollTopById: Record<string, number>;
    connectingParams: ConnectionHandle | null;
    batchConnectionPreview: CanvasBatchConnectionPreview | null;
    mouseWorld: Position;
    connectionTargetNodeId: string | null;
    connectionTargetHandleId?: string;
    connectionTargetAnchorRatio?: number;
    nodeById: Map<string, CanvasNodeData>;
    connections: CanvasConnection[];
    selectionBox: SelectionBox | null;
    selectedNodeBounds: NodeBounds;
    alignmentGuides: { vertical?: number; horizontal?: number };
};

type LeaferScene = {
    leafer: Leafer;
    world: Group;
    host: HTMLDivElement;
};

type OverlayScene = LeaferScene & {
    selection: Rect;
    selectionBounds: Rect;
    guides: Path;
    cables: CanvasConnectionCableScene;
    dragPreview: CanvasNodeDragPreview | null;
};

export function CanvasLeaferGraphicsLayer(props: CanvasLeaferGraphicsLayerProps) {
    const reducedMotion = useReducedMotion();
    const overlayHostRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<OverlayScene | null>(null);
    const viewportRef = useRef(props.viewport);
    const rasterViewportRef = useRef(props.viewport);
    const viewportSizeRef = useRef({ width: 1, height: 1 });
    const propsRef = useRef(props);
    const previousInteractionRef = useRef({ single: props.connectingParams, batch: props.batchConnectionPreview, nodeById: props.nodeById });
    const connectionIdsRef = useRef(new Set(props.connections.map((connection) => connection.id)));
    propsRef.current = props;

    useLayoutEffect(() => {
        const overlayHost = overlayHostRef.current;
        const container = (props.containerRef.current || overlayHost?.parentElement) as HTMLDivElement | null;
        if (!overlayHost || !container) return;

        const overlay = createOverlayScene(overlayHost, (nodeIds) => propsRef.current.onConnectionFeedbackNodesChange(nodeIds));
        overlayRef.current = overlay;
        previousInteractionRef.current = { single: null, batch: null, nodeById: propsRef.current.nodeById };
        connectionIdsRef.current = new Set(propsRef.current.connections.map((connection) => connection.id));

        const resize = () => {
            const rect = container.getBoundingClientRect();
            const size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), pixelRatio: canvasPixelRatio() };
            viewportSizeRef.current = size;
            overlay.leafer.resize(size);
            syncViewport(rasterViewportRef.current, size.width, size.height, overlay, propsRef.current);
            if (isViewportPreview(container, viewportRef.current, rasterViewportRef.current)) {
                applyScenePreview(viewportRef.current, rasterViewportRef.current, overlay);
            }
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        window.addEventListener("resize", resize);
        const unsubscribe = subscribeCanvasGraphicsViewportPreview(container, (next) => {
            viewportRef.current = next;
            // The container does not move with the camera. Reading layout here
            // would flush the world-layer style writes on every preview frame.
            const size = viewportSizeRef.current;
            if (isViewportPreview(container, next, rasterViewportRef.current)) {
                // 特效存在时同步真实镜头：节点比例圆圈自然缩放，固定屏幕线宽仍准确补偿。
                // 仅临时接线／冲击波期间同步这个小覆盖层，普通浏览继续复用合成预览。
                if (overlay.cables.hasContent || shouldRebaseCanvasRaster(next, rasterViewportRef.current)) {
                    syncViewport(next, size.width, size.height, overlay, propsRef.current);
                    rasterViewportRef.current = next;
                    forceSceneRender(overlay);
                    resetScenePreview(overlay);
                    return;
                }
                applyScenePreview(next, rasterViewportRef.current, overlay);
                return;
            }
            resetScenePreview(overlay);
            if (sameCanvasViewport(next, rasterViewportRef.current)) return;
            syncViewport(next, size.width, size.height, overlay, propsRef.current);
            rasterViewportRef.current = next;
        });
        const unsubscribeSelection = subscribeCanvasSelectionPreview(container, (selection) => {
            syncSelection(overlay.selection, selection, propsRef.current.theme);
        });
        const unsubscribeNodeDrag = subscribeCanvasNodeDragPreview(container, (preview) => {
            if (preview) overlay.cables.cancelImpacts();
            overlay.dragPreview = preview;
            syncLiveSelectionBounds(overlay, propsRef.current, viewportRef.current.k);
        });
        const cancelImpact = () => overlay.cables.cancelImpacts();
        container.addEventListener("pointerdown", cancelImpact, true);
        resize();

        return () => {
            unsubscribe();
            unsubscribeSelection();
            unsubscribeNodeDrag();
            container.removeEventListener("pointerdown", cancelImpact, true);
            resizeObserver.disconnect();
            window.removeEventListener("resize", resize);
            overlay.cables.destroy();
            overlay.leafer.destroy(true);
            overlayRef.current = null;
        };
    }, [props.containerRef, props.projectId]);

    useLayoutEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const previous = previousInteractionRef.current;
        const contacts = new Map<string, { target: CanvasNodeData; entries: { trackId: string; point: Position }[] }>();
        for (const connection of props.connections) {
            if (connectionIdsRef.current.has(connection.id)) continue;
            const single = previous.single;
            const fromSingle = single && (single.handleType === "source" ? connection.fromNodeId === single.nodeId : connection.toNodeId === single.nodeId);
            const fromBatch = previous.batch?.sourceNodeIds.includes(connection.fromNodeId);
            if (!fromSingle && !fromBatch) continue;
            const reversed = fromSingle && single.handleType === "target";
            const targetId = reversed ? connection.fromNodeId : connection.toNodeId;
            const handleId = reversed ? connection.fromHandleId : connection.toHandleId;
            const target = props.nodeById.get(targetId);
            if (!target) continue;
            const contact = contacts.get(targetId) || { target, entries: [] };
            contact.entries.push({
                trackId: fromSingle ? `${single.nodeId}:${single.handleType}:${single.handleId || ""}` : `batch:${connection.fromNodeId}`,
                point: { x: target.position.x + (reversed ? target.width : 0), y: connectionHandleY(target, handleId, props.scriptScrollTopById[targetId] || 0) },
            });
            contacts.set(targetId, contact);
        }
        const immediateFlashes: (() => void)[] = [];
        for (const [targetId, { target, entries }] of contacts) {
            const cornerRadius = Number.parseFloat(getComputedStyle(overlay.host).getPropertyValue("--node-radius"));
            const container = props.containerRef.current;
            const color = connectionColor(props.theme.canvas.background === "#f0f0f0");
            const bounds = { x: target.position.x, y: target.position.y, width: target.width, height: target.height, cornerRadius };
            // 创建节点与连线同批提交；新框不受撞击回弹，线头吸附与光效仍正常交接。
            const prepareFeedback = () => container && previous.nodeById.has(targetId) ? prepareCanvasConnectionImpact(container, targetId) : null;
            let releasing = false;
            // 必须先接管全部草稿再 sync；同一框的不同端口各自落框，但只撞击一次。
            for (const { trackId, point } of entries) releasing = overlay.cables.release(trackId, targetId, point, color, bounds, prepareFeedback) || releasing;
            // 未曾画出草稿的合法新增连接仍沿用原反馈，不伪造释放轨迹。
            if (!releasing) immediateFlashes.push(() => overlay.cables.flash(targetId, entries[0].point, color, bounds, prepareFeedback()));
        }
        syncOverlayContent(overlay, props, viewportRef.current.k, Boolean(reducedMotion));
        immediateFlashes.forEach((flash) => flash());
        connectionIdsRef.current = new Set(props.connections.map((connection) => connection.id));
        previousInteractionRef.current = { single: props.connectingParams, batch: props.batchConnectionPreview, nodeById: props.nodeById };
    }, [props.projectId, props.batchConnectionPreview, props.connectingParams, props.connectionPortEffect, props.connectionTargetAnchorRatio, props.connectionTargetHandleId, props.connectionTargetNodeId, props.connections, props.mouseWorld, props.nodeById, props.scriptScrollTopById, props.selectedNodeBounds, props.selectionBox, props.theme, reducedMotion]);

    useLayoutEffect(() => {
        const overlay = overlayRef.current;
        const container = props.containerRef.current;
        if (!overlay || !container) return;
        viewportRef.current = props.viewport;
        const size = viewportSizeRef.current;
        const hadPreview = hasScenePreview(overlay);
        if (hadPreview || !sameCanvasViewport(props.viewport, rasterViewportRef.current)) {
            syncViewport(props.viewport, size.width, size.height, overlay, props);
        }
        rasterViewportRef.current = props.viewport;
        // 新视口先同步到真实 DPR backing store，再撤销交互期的合成变换，避免出现跳帧。
        if (hadPreview) forceSceneRender(overlay);
        resetScenePreview(overlay);
    }, [props.containerRef, props.viewport]);

    useLayoutEffect(() => {
        const overlay = overlayRef.current;
        const container = props.containerRef.current;
        if (!overlay || !container) return;
        const size = viewportSizeRef.current;
        syncViewport(rasterViewportRef.current, size.width, size.height, overlay, props);
        if (isViewportPreview(container, viewportRef.current, rasterViewportRef.current)) {
            applyScenePreview(viewportRef.current, rasterViewportRef.current, overlay);
        }
    }, [props.alignmentGuides, props.containerRef, props.theme]);

    return (
        <>
            <div ref={overlayHostRef} data-canvas-leafer-overlay className="pointer-events-none absolute inset-0 z-[var(--z-canvas-overlay)] overflow-hidden" aria-hidden />
        </>
    );
}

function createOverlayScene(host: HTMLDivElement, onFeedbackNodesChange: (nodeIds: ReadonlySet<string>) => void): OverlayScene {
    const leafer = new Leafer({ view: host, width: 1, height: 1, pixelRatio: canvasPixelRatio(), fill: "transparent", hittable: false, smooth: true });
    const world = new Group({ hittable: false });
    const selection = new Rect({ visible: false, hittable: false });
    const selectionBounds = new Rect({ visible: false, hittable: false, fill: "transparent" });
    const guides = new Path({ visible: false, hittable: false });
    world.add(selection);
    world.add(selectionBounds);
    world.add(guides);
    const cables = new CanvasConnectionCableScene(world, host, () => leafer.forceRender(undefined, true), onFeedbackNodesChange);
    leafer.add(world);
    return { leafer, world, host, selection, selectionBounds, guides, cables, dragPreview: null };
}

function syncOverlayContent(scene: OverlayScene, props: CanvasLeaferGraphicsLayerProps, viewportScale: number, reducedMotion: boolean) {
    const selection = props.selectionBox;
    scene.selection.visible = Boolean(selection);
    if (selection) {
        syncSelection(scene.selection, selection, props.theme);
    }

    const bounds = props.selectedNodeBounds;
    scene.selectionBounds.visible = Boolean(bounds && !selection && !scene.dragPreview?.compact);
    if (bounds && !selection) {
        syncSelectionBounds(scene.selectionBounds, liveSelectedNodeBounds(bounds, scene.dragPreview), viewportScale);
        scene.selectionBounds.stroke = props.theme.node.label;
    }

    const drafts: CanvasCableDraft[] = [];
    const connecting = props.connectingParams;
    if (connecting) {
        const node = props.nodeById.get(connecting.nodeId);
        if (node) {
            const target = props.connectionTargetNodeId ? props.nodeById.get(props.connectionTargetNodeId) : undefined;
            const forward = connecting.handleType === "source";
            const fixed = { x: node.position.x + (forward ? node.width : 0), y: connectionHandleY(node, connecting.handleId, props.scriptScrollTopById[node.id] || 0) };
            drafts.push({
                id: `${node.id}:${connecting.handleType}:${connecting.handleId || ""}`,
                start: forward ? fixed : props.mouseWorld,
                end: forward ? props.mouseWorld : fixed,
                freeEnd: forward ? "end" : "start",
                target: target ? { x: target.position.x + (forward ? 0 : target.width), y: connectionHandleY(target, props.connectionTargetHandleId, props.scriptScrollTopById[target.id] || 0), nodeWidth: target.width } : undefined,
                color: connectionColor(props.theme.canvas.background === "#f0f0f0"),
                ink: props.theme.node.activeStroke,
            });
        }
    }
    const batch = props.batchConnectionPreview;
    if (batch) {
        const target = batch.status !== "invalid" && batch.targetNodeId ? props.nodeById.get(batch.targetNodeId) : undefined;
        for (const sourceNodeId of batch.sourceNodeIds) {
            const source = props.nodeById.get(sourceNodeId);
            if (!source) continue;
            drafts.push({
                id: `batch:${source.id}`,
                start: { x: source.position.x + source.width, y: connectionHandleY(source, undefined, props.scriptScrollTopById[source.id] || 0) },
                end: batch.mouseWorld,
                freeEnd: "end",
                target: target ? { x: target.position.x, y: connectionHandleY(target, batch.targetHandleId, props.scriptScrollTopById[target.id] || 0), nodeWidth: target.width } : undefined,
                color: connectionColor(props.theme.canvas.background === "#f0f0f0"),
                ink: batch.status === "invalid" ? props.theme.accent.danger : props.theme.node.activeStroke,
            });
        }
    }
    scene.cables.sync(drafts, viewportScale, reducedMotion || Boolean(scene.host.closest(".no-motion")), props.connectionPortEffect);
}

function syncSelection(rect: Rect, selection: SelectionBox, theme: CanvasTheme) {
    rect.set({
        x: Math.min(selection.startWorldX, selection.currentWorldX),
        y: Math.min(selection.startWorldY, selection.currentWorldY),
        width: Math.abs(selection.currentWorldX - selection.startWorldX),
        height: Math.abs(selection.currentWorldY - selection.startWorldY),
        fill: "transparent",
        stroke: theme.node.label,
        opacity: selection.hitMode === "intersect" ? 0.82 : 0.68,
    });
}

function syncViewport(viewport: ViewportTransform, width: number, height: number, overlay: OverlayScene, props: CanvasLeaferGraphicsLayerProps) {
    const scale = Math.max(viewport.k, 0.05);
    overlay.world.set({ x: viewport.x, y: viewport.y, scaleX: scale, scaleY: scale });

    overlay.selection.set({
        strokeWidth: 1 / scale,
        cornerRadius: 2 / scale,
        dashPattern: [4 / scale, 4 / scale],
    });
    if (props.selectedNodeBounds) syncSelectionBounds(overlay.selectionBounds, liveSelectedNodeBounds(props.selectedNodeBounds, overlay.dragPreview), scale);
    overlay.selectionBounds.set({
        strokeWidth: 1 / scale,
        cornerRadius: 2 / scale,
        dashPattern: [4 / scale, 4 / scale],
        opacity: 0.68,
    });
    overlay.cables.setScale(scale);
    overlay.guides.set({
        visible: typeof props.alignmentGuides.vertical === "number" || typeof props.alignmentGuides.horizontal === "number",
        path: guidePath(viewport, width, height, props.alignmentGuides),
        stroke: props.theme.accent.primary,
        strokeWidth: 1 / scale,
        dashPattern: [5 / scale, 5 / scale],
        opacity: 0.72,
    });
}

function isViewportPreview(container: HTMLDivElement, viewport: ViewportTransform, rasterViewport: ViewportTransform) {
    return container.dataset.canvasViewportInteracting === "true" && !sameCanvasViewport(viewport, rasterViewport);
}

function applyScenePreview(viewport: ViewportTransform, rasterViewport: ViewportTransform, ...scenes: LeaferScene[]) {
    // 将已栅格画面的屏幕坐标映射到实时视口，缩放手势期间不触碰 Leafer 场景树。
    const { ratio, x, y } = calculateCanvasPreviewTransform(viewport, rasterViewport);
    for (const scene of scenes) {
        scene.host.style.transformOrigin = "0 0";
        scene.host.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${ratio})`;
        scene.host.style.willChange = "transform";
        scene.host.dataset.canvasLeaferPreview = "true";
    }
}

function hasScenePreview(...scenes: LeaferScene[]) {
    return scenes.some((scene) => scene.host.dataset.canvasLeaferPreview === "true");
}

function resetScenePreview(...scenes: LeaferScene[]) {
    for (const scene of scenes) {
        scene.host.style.transform = "";
        scene.host.style.transformOrigin = "";
        scene.host.style.willChange = "";
        delete scene.host.dataset.canvasLeaferPreview;
    }
}

function forceSceneRender(...scenes: LeaferScene[]) {
    for (const scene of scenes) scene.leafer.forceRender(undefined, true);
}

function liveSelectedNodeBounds(bounds: NonNullable<NodeBounds>, preview: CanvasNodeDragPreview | null) {
    return offsetSelectedNodeBounds(bounds, preview);
}

function syncLiveSelectionBounds(scene: OverlayScene, props: CanvasLeaferGraphicsLayerProps, viewportScale: number) {
    const bounds = props.selectedNodeBounds;
    const selection = props.selectionBox;
    scene.selectionBounds.visible = Boolean(bounds && !selection && !scene.dragPreview?.compact);
    if (!bounds || selection) return;
    syncSelectionBounds(scene.selectionBounds, liveSelectedNodeBounds(bounds, scene.dragPreview), viewportScale);
    scene.selectionBounds.stroke = props.theme.node.label;
}

function syncSelectionBounds(rect: Rect, bounds: NonNullable<NodeBounds>, viewportScale: number) {
    const padding = 12 / Math.max(viewportScale, 0.05);
    rect.set({
        x: bounds.left - padding,
        y: bounds.top - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2,
    });
}

function guidePath(viewport: ViewportTransform, width: number, height: number, guides: { vertical?: number; horizontal?: number }) {
    const scale = Math.max(viewport.k, 0.05);
    const left = -viewport.x / scale;
    const top = -viewport.y / scale;
    const right = left + width / scale;
    const bottom = top + height / scale;
    const commands: string[] = [];
    if (typeof guides.vertical === "number") commands.push(`M ${guides.vertical} ${top} L ${guides.vertical} ${bottom}`);
    if (typeof guides.horizontal === "number") commands.push(`M ${left} ${guides.horizontal} L ${right} ${guides.horizontal}`);
    return commands.join(" ");
}

function canvasPixelRatio() {
    return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}
