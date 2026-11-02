import { nanoid } from "nanoid";
import { applyCanvasConnectionPromptSync, buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences, canvasNodeMentionToken, replaceCanvasReferenceMentions } from "./canvas-resource-references";
import { connectCanvasNodeReference } from "./canvas-text-mention";
import { writeCanvasNodePrompt } from "./canvas-node-prompt";
import { resolveVideoFrameIds } from "@/lib/video-frame-selection";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { ImageAsset } from "@/stores/use-asset-store";

export type CanvasVideoFrameRole = "first" | "last";
export type CanvasVideoFrameSource = string | File | ImageAsset;

/** 一次更新角色和素材连线；更换/清空图片位不删除源节点，也不改其他生成节点的引用。 */
export function assignCanvasVideoFrame(nodes: CanvasNodeData[], connections: CanvasConnection[], targetId: string, role: CanvasVideoFrameRole, sourceId?: string, endFrameSupported = true) {
    if (role === "last" && !endFrameSupported) throw new Error("当前模型不支持尾帧图片");
    const target = nodes.find((node) => node.id === targetId);
    if (!target || target.metadata?.locked) throw new Error("当前节点不可编辑");
    const references = buildCanvasNodeMentionReferenceMap(nodes, connections).get(targetId) || [];
    const frames = resolveVideoFrameIds(references.filter((item) => item.kind === "image").map((item) => item.nodeId), target.metadata, endFrameSupported);
    const previousId = frames[role];
    frames[role] = sourceId;
    const retainedIds = new Set([frames.first, frames.last].filter(Boolean));
    const configId = connections.find((edge) => edge.fromNodeId === targetId && nodes.find((node) => node.id === edge.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId;
    let nextConnections = previousId && !retainedIds.has(previousId)
        ? connections.filter((edge) => !(edge.fromNodeId === previousId && (edge.toNodeId === targetId || edge.toNodeId === configId)))
        : connections;
    if (sourceId) {
        const source = buildCanvasResourceReferences(nodes, nextConnections).find((reference) => reference.nodeId === sourceId && reference.kind === "image");
        if (!source) throw new Error("请选择图片节点");
        nextConnections = connectCanvasNodeReference(nodes, nextConnections, targetId, sourceId, nanoid()).connections;
    }
    let updated = nodes;
    const replaced = references.find((reference) => reference.nodeId === previousId);
    if (sourceId && replaced && previousId !== sourceId && !retainedIds.has(previousId)) {
        const source = nodes.find((node) => node.id === sourceId)!;
        const prompt = target.metadata?.composerContent ?? target.metadata?.prompt ?? "";
        const nextPrompt = replaceCanvasReferenceMentions(prompt, replaced, canvasNodeMentionToken(sourceId), source.title);
        updated = nodes.map((node) => node.id === targetId ? writeCanvasNodePrompt(node, nextPrompt) : node);
    }
    const synced = applyCanvasConnectionPromptSync(nodes, connections, updated, nextConnections);
    const nextNodes = synced.map((node) => node.id === targetId ? {
        ...node,
        metadata: {
            ...node.metadata,
            videoEditOperation: "image_to_video" as const,
            videoStartFrameNodeId: frames.first,
            videoEndFrameNodeId: frames.last,
        },
    } : node);
    return { nodes: nextNodes, connections: nextConnections };
}
