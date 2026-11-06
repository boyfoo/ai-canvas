import { createChannelTransport } from "@/services/api/channel-transport";
import { buildApiUrl, type ModelChannel } from "@/stores/use-config-store";

export type ArkVideoHistoryTask = {
    id: string;
    model: string;
    status: string;
    content?: { video_url?: string; last_frame_url?: string } | null;
    /** 方舟原始 Unix 时间戳，单位为秒。 */
    created_at?: number;
    updated_at?: number;
    duration?: number;
    resolution?: string;
    ratio?: string;
    draft?: boolean;
    error?: { code?: string; message?: string } | null;
    execution_expires_after?: number;
    frames?: number;
    framespersecond?: number;
    generate_audio?: boolean;
    output_format?: string;
    priority?: number;
    safety_identifier?: string;
    seed?: number;
    service_tier?: string;
    tools?: Array<{ type: string }>;
    usage?: {
        completion_tokens?: number;
        total_tokens?: number;
        tool_usage?: { web_search?: number };
    };
};

export type ArkVideoHistoryRequest = {
    page_num: number;
    page_size: number;
    status?: string;
    task_id?: string;
};

export type ArkVideoHistoryPage = {
    items: ArkVideoHistoryTask[];
    total: number;
};

function optionalStringFields(value: unknown, fields: string[]): boolean {
    if (value == null) return true;
    if (typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return fields.every(field => record[field] == null || typeof record[field] === "string");
}

/** 只读取渠道云端任务，不轮询生成、不下载媒体，也不写入本地记录。 */
export async function listArkVideoHistory(channel: ModelChannel, request: ArkVideoHistoryRequest, signal?: AbortSignal): Promise<ArkVideoHistoryPage> {
    signal?.throwIfAborted();
    if (![request.page_num, request.page_size].every(value => Number.isInteger(value) && value >= 1 && value <= 500)) {
        throw new Error("方舟历史页码和每页数量须为 1 至 500 的整数");
    }
    const query = new URLSearchParams({ page_num: String(request.page_num), page_size: String(request.page_size) });
    if (request.status?.trim()) query.set("filter.status", request.status.trim());
    if (request.task_id?.trim()) query.append("filter.task_ids", request.task_id.trim());
    const payload = await createChannelTransport(channel, "video").get<ArkVideoHistoryPage>(
        buildApiUrl(channel.baseUrl, `/contents/generations/tasks?${query}`),
        { signal, timeout_ms: 20_000 },
    );
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total) || payload.total < 0) {
        throw new Error("方舟历史接口未返回有效的任务列表及总数");
    }
    if (payload.items.some(task => !task || typeof task !== "object" || typeof task.id !== "string" || !task.id.trim() || typeof task.model !== "string" || typeof task.status !== "string" || !task.status.trim())) {
        throw new Error("方舟历史接口返回了缺少任务 ID、模型或状态的记录");
    }
    if (payload.items.some(task => !optionalStringFields(task, ["resolution", "ratio"]) || !optionalStringFields(task.content, ["video_url", "last_frame_url"]) || !optionalStringFields(task.error, ["message", "code"]))) {
        throw new Error("方舟历史接口返回了格式无效的任务规格、媒体链接或错误信息");
    }
    return { items: payload.items, total: payload.total };
}
