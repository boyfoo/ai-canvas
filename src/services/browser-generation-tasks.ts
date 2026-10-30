import dayjs from "dayjs";
import { createClientId } from "@/lib/client-id";
import { APP_STATE_STORE_NAME, localForageInstance } from "@/lib/localforage-storage";
import { scopedStorageKey } from "@/lib/user-scope";
import { browserVideoProvider } from "@/services/providers/ark-video-provider";
import { resolveModelChannel, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import type { BackendGenerationTaskOptions } from "@/services/api/generation-task";
import type { GenerationTask, TaskLog } from "@/services/api/task-center";

type BrowserTaskRecord = {
    task: GenerationTask;
    channel_id: string;
    provider_id: string;
    base_url: string;
    request?: Record<string, unknown>;
};
const store = localForageInstance(APP_STATE_STORE_NAME);
const queries = new Map<string, Promise<GenerationTask>>();
const unsavedConnections = new Map<string, ModelChannel>();
const now = () => dayjs().format("YYYY-MM-DD HH:mm:ss");
const prefix = () => `${scopedStorageKey("infinite-canvas:provider-tasks")}:`;
const key = (id: string) => `${prefix()}${id}`;
const operationLock = (operationId: string) => `${prefix()}operation:${operationId}`;
export const isBrowserGenerationTask = (id: string) => id.startsWith("browser-task-");

function notify(task: GenerationTask, event = "canvas:task-updated") {
    window.dispatchEvent(new CustomEvent(event, { detail: { task } }));
}
async function read(id: string) {
    const record = await store.getItem<BrowserTaskRecord>(key(id));
    if (!record) throw new Error("浏览器中没有找到该任务记录");
    return record;
}
async function write(record: BrowserTaskRecord) {
    record.task.updatedAt = now();
    await store.setItem(key(record.task.id), record);
    notify(record.task);
    return record.task;
}
function connection(record: BrowserTaskRecord): ModelChannel {
    const channel = useConfigStore.getState().config.channels.find(item => item.id === record.channel_id) || unsavedConnections.get(record.channel_id);
    if (!channel || channel.provider_id !== record.provider_id) throw new Error("此任务的提供商连接已被删除，请恢复连接后查询");
    if (channel.baseUrl.replace(/\/+$/, "") !== record.base_url) throw new Error("此任务的服务地址已变更，请恢复原地址后查询");
    if (!channel.apiKey.trim()) throw new Error("请先填写此任务对应连接的 API Key");
    return channel;
}
export function usesBrowserVideoProvider(options: Pick<BackendGenerationTaskOptions, "config" | "mode">) {
    if ((options.config.taskWorkflowProvider || "model") !== "model") return false;
    return Boolean(browserVideoProvider(resolveModelChannel(options.config, options.config.model).provider_id));
}

export async function createBrowserGenerationTask(options: BackendGenerationTaskOptions): Promise<GenerationTask> {
    const channel = resolveModelChannel(options.config, options.config.model);
    const provider = browserVideoProvider(channel.provider_id);
    if (!provider || options.mode !== "video") throw new Error("该提供商仅支持浏览器视频生成");
    if (!useConfigStore.getState().config.channels.some(item => item.id === channel.id)) unsavedConnections.set(channel.id, channel);
    const operationId = options.clientOperationId || createClientId();
    // 同一个操作标识只允许提交一次；跨标签页也使用浏览器锁协调。
    return navigator.locks.request(operationLock(operationId), async () => {
        const existing = (await listBrowserGenerationTasks()).find(task => task.clientOperationId === operationId);
        if (existing) return existing;
        const metadata = options.metadata || {};
        const record: BrowserTaskRecord = {
            channel_id: channel.id, provider_id: channel.provider_id!, base_url: channel.baseUrl.replace(/\/+$/, ""),
            task: {
                id: `browser-task-${createClientId()}`, projectId: options.projectId, type: "canvas_video", provider: channel.provider_id,
                status: "queued", stage: "preparing", prompt: options.prompt, model: options.config.model,
                clientOperationId: operationId, retryOf: options.retryOf, attemptGroupId: options.attemptGroupId,
                attempts: 1, createdAt: now(), updatedAt: now(),
                clientContext: { source: typeof metadata.source === "string" ? metadata.source : "canvas", nodeId: typeof metadata.nodeId === "string" ? metadata.nodeId : undefined, batchIndex: typeof metadata.batchIndex === "number" ? metadata.batchIndex : undefined, batchCount: typeof metadata.batchCount === "number" ? metadata.batchCount : undefined },
            },
        };
        await write(record); notify(record.task, "canvas:task-created"); options.onTaskUpdate?.(record.task);
        let submitted = false;
        try {
            record.request = await provider.prepare(options, (label, loadedBytes, totalBytes) => {
                options.onTaskUpdate?.({ ...record.task, referenceProgress: { label, phase: loadedBytes >= totalBytes && totalBytes > 0 ? "processing" : "transferring", loadedBytes, totalBytes, bytesPerSecond: 0, startedAt: Date.now(), updatedAt: Date.now() } });
            });
            const { content: _content, ...parameters } = record.request;
            record.task.inputJson = JSON.stringify({ mode: "video", prompt: options.prompt, parameters });
            if (options.signal?.aborted) throw new DOMException("已停止等待", "AbortError");
            record.task = { ...record.task, status: "running", stage: "submitting", startedAt: now() };
            await write(record);
            submitted = true;
            record.task.providerRequestId = await provider.submit(channel, record.request, options.signal);
            record.task.stage = "queued"; record.task.status = "queued";
            // 不长期保存输入中的临时下载链接或 Base64 素材；重试由画布重新构建。
            delete record.request;
            await write(record); options.onTaskUpdate?.(record.task);
            return record.task;
        } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
            const uncertain = submitted && !(status >= 400 && status < 500 && status !== 408);
            record.task = { ...record.task, status: uncertain ? "running" : "failed", stage: uncertain ? "submission_unknown" : "failed", errorCode: uncertain ? "submission_uncertain" : "provider_submission_failed", error: uncertain ? "方舟提交结果未确认，请先在方舟控制台查询；此任务不会自动重复提交" : error instanceof Error ? error.message : "视频提交失败" };
            if (uncertain) record.task.outcome = { phase: "retrievable", regenerate: "blocked", reason: "submission_unknown" };
            delete record.request;
            await write(record); options.onTaskUpdate?.(record.task);
            throw new Error(record.task.error, { cause: error });
        }
    });
}

export async function listBrowserGenerationTasks(): Promise<GenerationTask[]> {
    const keys = (await store.keys()).filter(item => item.startsWith(prefix()));
    const records = await Promise.all(keys.map(item => store.getItem<BrowserTaskRecord>(item)));
    return records.flatMap(record => record ? [record.task] : []);
}

export function queryBrowserGenerationTask(id: string, signal?: AbortSignal): Promise<GenerationTask> {
    // 带取消信号的观察独立执行，避免一个等待者取消其他观察者。
    if (!signal && queries.has(id)) return queries.get(id)!;
    const promise = navigator.locks.request(`browser-task:${id}`, { signal }, async () => {
        const record = await read(id);
        if (["failed", "cancelled"].includes(record.task.status) || (record.task.status === "succeeded" && record.task.resultState === "READY")) return record.task;
        if (!record.task.providerRequestId) {
            const held = (await navigator.locks.query()).held || [];
            const preparing = held.some(lock => lock.name === operationLock(record.task.clientOperationId || ""));
            if (record.task.stage === "preparing" && !preparing) {
                record.task.status = "failed"; record.task.stage = "failed";
                record.task.error = "页面在准备素材时已关闭，本次尚未提交生成任务";
                delete record.request;
                return write(record);
            }
            if (record.task.stage === "submitting" && preparing) return record.task;
            if (record.task.stage === "submission_unknown" || record.task.stage === "submitting") {
                record.task.stage = "submission_unknown";
                record.task.error = "提交结果未确认，请在方舟控制台确认任务 ID 后，通过任务详情关联原任务";
                record.task.outcome = { phase: "retrievable", regenerate: "blocked", reason: "submission_unknown" };
                delete record.request;
                return write(record);
            }
            return record.task;
        }
        const observed = await browserVideoProvider(record.provider_id)!.query(connection(record), record.task.providerRequestId, signal);
        record.task = { ...record.task, status: observed.status, stage: observed.status, error: observed.error, errorCode: observed.error_code };
        if (observed.status === "succeeded") {
            if (!observed.video_url || !/^https?:\/\//.test(observed.video_url)) throw new Error("方舟已完成任务，但没有返回视频地址");
            record.task.previewUrl = observed.video_url; record.task.previewKind = "video";
            record.task.resultJson = JSON.stringify({ mode: "video", video: { dataUrl: observed.video_url, url: observed.video_url, previewUrl: observed.last_frame_url, durationMs: observed.duration_ms, mimeType: "video/mp4" } });
            record.task.resultState = "PENDING_MATERIALIZATION";
        }
        if (["succeeded", "failed", "cancelled"].includes(observed.status)) record.task.completedAt = now();
        return write(record);
    });
    if (!signal) { queries.set(id, promise); void promise.finally(() => queries.delete(id)).catch(() => undefined); }
    return promise;
}

export async function associateBrowserTask(id: string, upstream_id: string) {
    if (!/^cgt-[A-Za-z0-9_-]+$/.test(upstream_id)) throw new Error("请填写方舟返回的完整 cgt- 任务 ID");
    await navigator.locks.request(`browser-task:${id}`, async () => {
        const record = await read(id);
        if (record.task.providerRequestId) throw new Error("此任务已经关联方舟任务");
        if (!["submitting", "submission_unknown"].includes(record.task.stage || "")) throw new Error("此任务没有待确认的方舟提交");
        const observed = await browserVideoProvider(record.provider_id)!.query(connection(record), upstream_id);
        if (observed.id !== upstream_id) throw new Error("方舟返回的任务 ID 不匹配");
        record.task.providerRequestId = upstream_id; record.task.status = "running"; record.task.stage = "running";
        record.task.error = undefined; record.task.errorCode = undefined;
        record.task.outcome = undefined;
        await write(record);
    });
    return queryBrowserGenerationTask(id);
}

export async function cancelBrowserGenerationTask(id: string) {
    return navigator.locks.request(`browser-task:${id}`, async () => {
        const record = await read(id);
        if (!record.task.providerRequestId) throw new Error("提交结果未确认，无法取消；请先关联方舟任务 ID");
        const provider = browserVideoProvider(record.provider_id)!;
        const channel = connection(record);
        const observed = await provider.query(channel, record.task.providerRequestId);
        if (observed.status !== "queued") throw new Error("方舟仅支持取消排队中的任务，请刷新状态查看生成结果");
        await provider.cancel(channel, record.task.providerRequestId);
        record.task.status = "cancelled"; record.task.stage = "cancelled"; record.task.completedAt = now();
        record.task.providerCancelStatus = "confirmed";
        await write(record); notify(record.task, "canvas:task-cancelled");
        return record.task;
    });
}

export async function deleteBrowserGenerationTask(id: string) {
    const record = await read(id);
    if (["queued", "running"].includes(record.task.status)) throw new Error("请先完成或取消任务，再删除本地记录");
    await store.removeItem(key(id));
}
export async function browserTaskLogs(id: string): Promise<TaskLog[]> {
    const { task } = await read(id);
    return [{ id: `${id}:state`, taskId: id, level: task.error ? "warn" : "info", stage: task.stage || task.status, provenance: "provider_observation", createdAt: task.updatedAt, summary: task.error || `方舟任务 ${task.providerRequestId || "尚未确认"}：${task.status}` }];
}
export async function updateBrowserTaskResult(id: string, resultJson: string, asset_id: string) {
    return navigator.locks.request(`browser-task:${id}`, async () => {
        const record = await read(id);
        record.task.resultJson = resultJson; record.task.resultState = "READY";
        record.task.outcome = { phase: "ready", regenerate: "allowed", reason: "result_ready" };
        record.task.outputs = [{ outputIndex: 0, mediaType: "video", materializedAssetId: asset_id }];
        return write(record);
    });
}
