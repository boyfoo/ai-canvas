import { nanoid } from "nanoid";

import { nextCanvasVersionLabel } from "@/lib/canvas/canvas-layout";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

function hasMediaResult(node: CanvasNodeData): boolean {
    return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio)
        && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

export function canvasMediaResultsMatch(left: CanvasNodeData, right: CanvasNodeData): boolean {
    if (left.type !== right.type) return false;
    const a = left.metadata;
    const b = right.metadata;
    return Boolean((a?.assetId && a.assetId === b?.assetId)
        || (a?.storageKey && a.storageKey === b?.storageKey)
        || (a?.content && a.content === b?.content));
}

function snapshotMetadata(metadata: CanvasNodeMetadata | undefined, rootId: string, label: string, ownerId: string): CanvasNodeMetadata {
    const snapshot: CanvasNodeMetadata = {
        ...resetGenerationTaskMetadata(metadata, "success"),
        versionOfNodeId: rootId,
        versionLabel: label,
        versionPrimary: false,
        versionStackOwnerId: ownerId,
    };
    // 历史只持有已完成媒体；提交凭据和消费效果属于原节点，不能让快照被恢复器当成新目标。
    delete snapshot.taskClientOperationInput;
    delete snapshot.taskClientOperationTerminal;
    delete snapshot.generationEffectKeys;
    delete snapshot.generationFailure;
    delete snapshot.taskOutcomeSource;
    delete snapshot.agentGenerationContinuation;
    delete snapshot.fileUpload;
    delete snapshot.generationBatches;
    delete snapshot.isBatchRoot;
    delete snapshot.batchRootId;
    delete snapshot.batchChildIds;
    delete snapshot.generationOutputNodeIds;
    delete snapshot.batchFailedCount;
    delete snapshot.primaryImageId;
    delete snapshot.imageBatchExpanded;
    delete snapshot.batchUsesReferenceImages;
    // 输入框是下一次生成的可变草稿，prompt 才是上次完成结果的实际提示词。
    if (metadata?.prompt) snapshot.composerContent = metadata.prompt;
    return snapshot;
}

// 原位生成保留稳定节点 ID，同时把生成前媒体快照放入同一版本族。
export function prepareInPlaceMediaVersion(nodes: CanvasNodeData[], nodeId: string): CanvasNodeData[] {
    const source = nodes.find((node) => node.id === nodeId);
    if (!source || source.metadata?.versionStackOwnerId || source.metadata?.status === "loading"
        || ["submitting", "unknown"].includes(source.metadata?.generationSubmissionState || "") || isCanvasNodeGenerating(source)) return nodes;
    const isCompletedMedia = (node: CanvasNodeData) => hasMediaResult(node) && node.metadata?.status === "success"
        && !node.metadata.versionStackOwnerId && !isCanvasNodeGenerating(node)
        && !["submitting", "unknown"].includes(node.metadata.generationSubmissionState || "");
    const childIds = new Set(source.metadata?.batchChildIds || []);
    const children = source.type === CanvasNodeType.Image && (source.metadata?.isBatchRoot || childIds.size > 0)
        ? nodes.filter((node) => node.id !== source.id && (node.metadata?.batchRootId === source.id || childIds.has(node.id)) && isCompletedMedia(node))
        : [];
    const primaryIndex = children.findIndex((node) => node.id === source.metadata?.primaryImageId || canvasMediaResultsMatch(node, source));
    if (primaryIndex > 0) children.unshift(...children.splice(primaryIndex, 1));
    const candidates = [
        ...(isCompletedMedia(source) && !children.some((node) => canvasMediaResultsMatch(node, source)) ? [source] : []),
        ...children,
    ];
    if (!candidates.length) return nodes;
    const rootId = source.metadata?.versionOfNodeId || source.id;
    let next = nodes;
    let archived = false;
    for (const candidate of candidates) {
        // 视频失败重试仍可能展示上次媒体；同一媒体只归档一次，不制造失败版本。
        if (candidate.id === source.id && next.some((node) => node.metadata?.versionStackOwnerId === source.id && canvasMediaResultsMatch(node, candidate))) continue;
        const label = archived ? nextCanvasVersionLabel(rootId, next) : source.metadata?.versionLabel || "A";
        const snapshot: CanvasNodeData = {
            ...candidate,
            // 批次子图本身转为历史，保持其已有下游引用 ID；根节点媒体才需要独立快照 ID。
            id: candidate.id === source.id ? nanoid() : candidate.id,
            title: `${candidate.title.replace(/ · [A-Z]+$/, "")} · ${label}`,
            position: { ...candidate.position },
            parentId: undefined,
            metadata: snapshotMetadata(candidate.metadata, rootId, label, source.id),
        };
        next = candidate.id === source.id ? [...next, snapshot] : next.map((node) => node.id === candidate.id ? snapshot : node);
        archived = true;
    }
    // 从历史恢复的当前媒体已经归档；再次生成仍要获得新标签，不重复创建同媒体快照。
    if (!archived && !isCompletedMedia(source)) return nodes;
    const nextLabel = nextCanvasVersionLabel(rootId, next);
    return next.map((node) => {
        if ((node.metadata?.versionOfNodeId || node.id) !== rootId) return node;
        if (node.id !== source.id) return { ...node, metadata: { ...node.metadata, versionPrimary: false } };
        return { ...node, metadata: { ...node.metadata, versionOfNodeId: rootId, versionLabel: nextLabel, versionPrimary: true } };
    });
}

/** 历史快照保持不可变；把所选媒体复制到稳定节点，现有历史节点的下游引用仍指向原媒体。 */
export function restoreCanvasMediaVersion(nodes: CanvasNodeData[], snapshotId: string): { nodes: CanvasNodeData[]; ownerId: string; error?: string } {
    const snapshot = nodes.find((node) => node.id === snapshotId);
    const ownerId = snapshot?.metadata?.versionStackOwnerId || "";
    const owner = nodes.find((node) => node.id === ownerId);
    if (!snapshot || !owner || !hasMediaResult(snapshot) || snapshot.type !== owner.type) return { nodes, ownerId, error: "历史结果已不存在" };
    const batchChildIds = new Set(owner.metadata?.batchChildIds || []);
    const batchChildren = owner.metadata?.isBatchRoot || batchChildIds.size > 0
        ? nodes.filter((node) => node.id !== owner.id && (node.metadata?.batchRootId === owner.id || batchChildIds.has(node.id)))
        : [];
    if (owner.metadata?.status === "loading" || isCanvasNodeGenerating(owner)
        || ["submitting", "unknown"].includes(owner.metadata?.generationSubmissionState || "")
        || batchChildren.some((node) => node.metadata?.status === "loading" || isCanvasNodeGenerating(node)
            || ["submitting", "unknown"].includes(node.metadata?.generationSubmissionState || ""))) {
        return { nodes, ownerId, error: "当前生成尚未结束，请完成或处理原任务后再切换历史" };
    }
    // 退出已结束的多图批次前先归档所有成功子图，不能只保存当前主图。
    const workingNodes = batchChildren.length ? prepareInPlaceMediaVersion(nodes, owner.id) : nodes;
    const rootId = owner.metadata?.versionOfNodeId || owner.id;
    const rootMetadata = snapshotMetadata(snapshot.metadata, rootId, snapshot.metadata?.versionLabel || "A", owner.id);
    delete rootMetadata.versionStackOwnerId;
    rootMetadata.versionPrimary = true;
    // 这些字段描述当前节点在图中的位置/职责，不能被历史媒体的副本身份覆盖。
    for (const key of ["generationResultPlacement", "generatedFromNodeId", "copiedFromNodeId", "referenceSetId", "referenceAssetNodeIds", "videoStartFrameNodeId", "videoEndFrameNodeId", "videoMiddleFrameNodeId", "videoReferenceOrder", "directorSceneId", "directorShotId", "directorPreviewNodeId", "directorDepthNodeId", "directorNormalNodeId", "directorClayVideoNodeId", "workflowSlot", "batchRootId"] as const) {
        if (Object.hasOwn(owner.metadata || {}, key)) Object.assign(rootMetadata, { [key]: owner.metadata?.[key] });
        else delete rootMetadata[key];
    }
    const keepOwnerMedia = hasMediaResult(owner) && !canvasMediaResultsMatch(owner, snapshot)
        && !workingNodes.some((node) => node.metadata?.versionStackOwnerId === owner.id && canvasMediaResultsMatch(node, owner));
    const detachedChildIds = new Set(batchChildren.map((node) => node.id));
    const restored = workingNodes.map((node) => {
        if (node.id === owner.id) return { ...owner, title: snapshot.title.replace(/ · [A-Z]+$/, ""), metadata: rootMetadata };
        // 成功子图已成为不可变历史；失败壳仅解除批次关系，保留 ID 以免破坏未知的外部引用。
        if (detachedChildIds.has(node.id) && !node.metadata?.versionStackOwnerId && node.metadata?.batchRootId === owner.id) {
            const metadata = { ...node.metadata };
            delete metadata.batchRootId;
            return { ...node, metadata };
        }
        return node;
    });
    if (keepOwnerMedia) {
        const label = owner.metadata?.versionLabel || "A";
        restored.push({
            ...owner,
            id: nanoid(),
            parentId: undefined,
            position: { ...owner.position },
            title: `${owner.title.replace(/ · [A-Z]+$/, "")} · ${label}`,
            metadata: snapshotMetadata(owner.metadata, rootId, label, owner.id),
        });
    }
    return { nodes: restored, ownerId };
}
