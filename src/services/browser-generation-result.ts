import { getActiveUserScope } from "@/lib/user-scope";
import { buildGenerationTaskNodeResult } from "@/lib/canvas/canvas-generation-task-sync";
import { readImageMeta } from "@/lib/image-utils";
import { captureVideoPoster } from "@/lib/video-poster";
import { queryBrowserGenerationTask, updateBrowserTaskResult } from "@/services/browser-generation-tasks";
import { generationArtifactStorageKey, loadOrStoreGenerationArtifact } from "@/services/generation-artifact-sink";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { persistCanvasDocument } from "@/services/local-workspace-repository";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { bindBackendCanvasGenerationResult } from "@/services/canvas-generation-consumer";

type VideoLastFrame = NonNullable<NonNullable<BackendGenerationResult["video"]>["lastFrame"]>;

/** 官方尾帧链接有有效期，取回视频时同步保存图片；重试共用文件键和素材键。 */
async function persistVideoLastFrame(frame: VideoLastFrame, taskId: string, canvasId: string, signal?: AbortSignal): Promise<VideoLastFrame> {
    const effectKey = `materialize:${taskId}:last-frame`;
    const storageKey = generationArtifactStorageKey(effectKey, "image", getActiveUserScope());
    const mimeType = "image/jpeg";
    const blob = await loadOrStoreGenerationArtifact({
        effectKey: storageKey,
        read: getImageBlob,
        materialize: async () => {
            const response = await fetch(frame.dataUrl, { signal, credentials: "omit" });
            if (!response.ok) throw new Error(`尾帧取回失败（HTTP ${response.status}），可稍后继续取回原任务`);
            const downloaded = await response.blob();
            if (!downloaded.size || /^(text\/|application\/json)/i.test(downloaded.type)) throw new Error("方舟尾帧地址未返回有效的图片文件");
            return downloaded.type === mimeType ? downloaded : downloaded.slice(0, downloaded.size, mimeType);
        },
        write: async (key, value) => { await setImageBlob(key, value); },
    });
    const url = await resolveImageUrl(storageKey);
    if (!url) throw new Error("生成尾帧未能从浏览器存储读取");
    const meta = await readImageMeta(url, signal);
    const data = { dataUrl: url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType };
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
        input.onPhaseChange?.("fetching");
        const effectKey = `materialize:${task.id}:0`;
        const storageKey = generationArtifactStorageKey(effectKey, "video", getActiveUserScope());
        const blob = await loadOrStoreGenerationArtifact({
            effectKey: storageKey, read: getMediaBlob,
            materialize: async () => {
                const response = await fetch(result.video!.url || result.video!.dataUrl, { signal: input.signal, credentials: "omit" });
                if (!response.ok) throw new Error(`视频取回失败（HTTP ${response.status}），可稍后继续取回原任务`);
                const downloaded = await response.blob();
                if (!downloaded.size || /^(text\/|application\/json)/i.test(downloaded.type)) throw new Error("方舟视频地址未返回有效的视频文件");
                // 方舟的实际容器格式决定 MIME，临时下载地址可能使用通用二进制响应头；这里只修正类型，不转码。
                return downloaded.type === mimeType ? downloaded : downloaded.slice(0, downloaded.size, mimeType);
            },
            write: async (key, value) => { await setMediaBlob(key, value); },
        });
        const url = await resolveMediaUrl(storageKey);
        if (!url) throw new Error("生成视频未能从浏览器存储读取");
        assertCurrent();
        const videoMeta = await captureVideoPoster(url, { signal: input.signal });
        assertCurrent();
        if (result.video.lastFrame && !result.video.lastFrame.assetId) {
            result.video.lastFrame = await persistVideoLastFrame(result.video.lastFrame, task.id, input.canvasId, input.signal);
            assertCurrent();
        }
        input.onPhaseChange?.("saving");
        const assetId = await useAssetStore.getState().addGenerationAsset(effectKey, {
            kind: "video", title: "方舟生成视频", coverUrl: "", tags: ["生成"], status: "confirmed", source: "画布生成",
            metadata: { taskId: task.id, canvasId: input.canvasId, generationEffectKey: effectKey, outputIndex: 0, ...(result.video.lastFrame?.assetId ? { lastFrameAssetId: result.video.lastFrame.assetId } : {}) },
            data: { url, storageKey, width: videoMeta.width, height: videoMeta.height, durationMs: videoMeta.durationMs || result.video.durationMs, bytes: blob.size, mimeType, hasAudio: videoMeta.hasAudio },
        }, input.signal);
        result.video = { ...result.video, dataUrl: url, storageKey, width: videoMeta.width, height: videoMeta.height, durationMs: videoMeta.durationMs || result.video.durationMs, bytes: blob.size, mimeType };
        const completed = await updateBrowserTaskResult(task.id, JSON.stringify(result), assetId);
        assertCurrent();
        const project = useCanvasStore.getState().openProject(input.canvasId);
        if (!project?.nodes.some(node => node.id === input.nodeId)) return;
        const target = project.nodes.find(node => node.id === input.nodeId)!;
        const updated = await buildGenerationTaskNodeResult(target, completed, project.nodes);
        assertCurrent();
        const current = useCanvasStore.getState().openProject(input.canvasId);
        if (!current?.nodes.some(node => node.id === input.nodeId)) return;
        const nodes = current.nodes.map(node => node.id === input.nodeId ? { ...updated, metadata: { ...updated.metadata, assetId, hasAudio: videoMeta.hasAudio } } : node);
        useCanvasStore.getState().updateProject(project.id, { nodes });
        await persistCanvasDocument(project.id, { nodes, connections: current.connections });
        if (input.isCurrent()) { input.nodesRef.current = nodes; input.setNodes(nodes); }
    });
}
