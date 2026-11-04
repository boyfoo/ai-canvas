import { buildGenerationTaskNodeResult } from "@/lib/canvas/canvas-generation-task-sync";
import { queryBrowserGenerationTask, updateBrowserTaskResult } from "@/services/browser-generation-tasks";
import { persistCanvasDocument } from "@/services/local-workspace-repository";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { bindBackendCanvasGenerationResult } from "@/services/canvas-generation-consumer";

type VideoLastFrame = NonNullable<NonNullable<BackendGenerationResult["video"]>["lastFrame"]>;

/** 只保存尾帧链接及素材记录，不下载图片；重试共用素材键。链接有效期由提供商决定。 */
async function persistVideoLastFrame(frame: VideoLastFrame, taskId: string, canvasId: string, signal?: AbortSignal): Promise<VideoLastFrame> {
    const effectKey = `materialize:${taskId}:last-frame`;
    const url = frame.url || frame.dataUrl;
    const image = new Image();
    const abort = () => image.removeAttribute("src");
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    let width: number;
    let height: number;
    try {
        // 原生图片解码可读取尺寸，不设置 crossOrigin，也不读取图片像素或转换 Blob。
        image.src = url;
        await image.decode();
        signal?.throwIfAborted();
        width = image.naturalWidth;
        height = image.naturalHeight;
    } finally {
        signal?.removeEventListener("abort", abort);
        image.removeAttribute("src");
    }
    const data = { dataUrl: url, width, height, bytes: frame.bytes ?? 0, mimeType: frame.mimeType || "image/jpeg" };
    const assetId = await useAssetStore.getState().addGenerationAsset(effectKey, {
        kind: "image", title: "方舟视频尾帧", coverUrl: url, tags: ["生成", "尾帧"], status: "confirmed", source: "画布生成",
        metadata: { taskId, canvasId, generationEffectKey: effectKey, role: "last_frame" },
        data,
    }, signal);
    return { ...data, assetId };
}

export async function bindBrowserGenerationResult(input: Parameters<typeof bindBackendCanvasGenerationResult>[0]) {
    const assertCurrent = () => {
        if (input.signal?.aborted || !input.isCurrent() || (input.isNodeOwned && !input.isNodeOwned())) throw new DOMException("画布操作已结束", "AbortError");
    };
    assertCurrent();
    if ((input.outputIndex || 0) !== 0) throw new Error("方舟视频任务只有一个视频输出");
    return navigator.locks.request(`browser-result:${input.task.id}`, { signal: input.signal }, async () => {
        const task = await queryBrowserGenerationTask(input.task.id, input.signal);
        const result = JSON.parse(task.resultJson || "{}") as BackendGenerationResult;
        if (!result.video) throw new Error("任务没有可用的视频结果");
        const mimeType = result.video.mimeType;
        if (!mimeType) throw new Error("任务没有返回视频格式信息");
        const url = result.video.url || result.video.dataUrl;
        if (!url) throw new Error("任务没有返回视频链接");
        assertCurrent();
        input.onPhaseChange?.("saving");
        const effectKey = `materialize:${task.id}:0`;
        // 直接交给原生媒体元素加载。fetch / Blob / canvas 抽帧需要 CORS，不能作为显示的前置条件。
        result.video = { ...result.video, dataUrl: url, storageKey: undefined };
        if (result.video.lastFrame && !result.video.lastFrame.assetId) {
            result.video.lastFrame = await persistVideoLastFrame(result.video.lastFrame, task.id, input.canvasId, input.signal);
            assertCurrent();
        }
        const assetId = await useAssetStore.getState().addGenerationAsset(effectKey, {
            kind: "video", title: "方舟生成视频", coverUrl: "", tags: ["生成"], status: "confirmed", source: "画布生成",
            metadata: { taskId: task.id, canvasId: input.canvasId, generationEffectKey: effectKey, outputIndex: 0, ...(result.video.lastFrame?.assetId ? { lastFrameAssetId: result.video.lastFrame.assetId } : {}) },
            data: { url, width: result.video.width ?? 0, height: result.video.height ?? 0, durationMs: result.video.durationMs, bytes: result.video.bytes ?? 0, mimeType },
        }, input.signal);
        const completed = await updateBrowserTaskResult(task.id, JSON.stringify(result), assetId);
        assertCurrent();
        const project = useCanvasStore.getState().openProject(input.canvasId);
        if (!project?.nodes.some(node => node.id === input.nodeId)) return;
        const target = project.nodes.find(node => node.id === input.nodeId)!;
        const updated = await buildGenerationTaskNodeResult(target, completed, project.nodes);
        assertCurrent();
        const current = useCanvasStore.getState().openProject(input.canvasId);
        if (!current?.nodes.some(node => node.id === input.nodeId)) return;
        const nodes = current.nodes.map(node => node.id === input.nodeId ? { ...updated, metadata: { ...updated.metadata, assetId } } : node);
        useCanvasStore.getState().updateProject(project.id, { nodes });
        await persistCanvasDocument(project.id, { nodes, connections: current.connections });
        if (input.isCurrent()) { input.nodesRef.current = nodes; input.setNodes(nodes); }
    });
}
