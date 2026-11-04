import { explainGenerationError, preserveGenerationFailure, type GenerationFailureDiagnostics } from "@/lib/generation-error";
import { APP_STATE_STORE_NAME, localForageInstance } from "@/lib/localforage-storage";
import { scopedStorageKey } from "@/lib/user-scope";
import { createChannelTransport } from "@/services/api/channel-transport";
import { isReferenceHTTPSLink } from "@/services/api/reference-link-replacement";
import { buildApiUrl, channelConnectionSignature, type ModelChannel } from "@/stores/use-config-store";

type FileInfo = {
    id?: string;
    purpose?: unknown;
    status?: unknown;
    expire_at?: number;
    download_url?: unknown;
    error?: { message?: string };
};

type FileResponseDiagnostics = {
    purpose: "agent" | "user_data" | "missing" | "unexpected";
    status: "active" | "processing" | "failed" | "missing" | "unexpected";
    download_url_present: boolean;
    download_url_type: string;
    download_url_valid: boolean;
};

/** 只保存可恢复的 Files 回执；临时签名链接、凭证和完整响应始终留在调用内存中。 */
type FileReceipt = {
    file_id: string;
    expire_at?: number;
    post_response: FileResponseDiagnostics;
};

const receiptStore = localForageInstance(APP_STATE_STORE_NAME);
const MAX_FILE_QUERIES = 90;

function responseDiagnostics(file: FileInfo): FileResponseDiagnostics {
    return {
        purpose: file.purpose === "agent" || file.purpose === "user_data" ? file.purpose : file.purpose === undefined ? "missing" : "unexpected",
        status: file.status === "active" || file.status === "processing" || file.status === "failed" ? file.status : file.status === undefined ? "missing" : "unexpected",
        download_url_present: Object.hasOwn(file, "download_url"),
        download_url_type: file.download_url === null ? "null" : typeof file.download_url,
        download_url_valid: typeof file.download_url === "string" && isReferenceHTTPSLink(file.download_url),
    };
}

export class ArkFileReferenceError extends Error {
    readonly code = "provider_reference_link_missing";
    readonly failureDiagnostics: GenerationFailureDiagnostics;

    constructor(fileId: string, post: FileResponseDiagnostics, get: FileResponseDiagnostics | undefined, reused: boolean) {
        super("文件已上传，但 Files 响应没有生成可引用地址；请在连接的素材传输中选择对象存储或 HTTPS 链接。尚未提交生成。");
        this.name = "ArkFileReferenceError";
        this.failureDiagnostics = {
            source: "reference_upload",
            stage: "preparing",
            providerCode: this.code,
            // 此处只包含白名单元数据，不能放入 URL、响应正文或请求头。
            summary: JSON.stringify({ file_id: fileId, upload_request_purpose: "agent", reused, post_response: post, get_response: get ?? "not_requested" }),
        };
        preserveGenerationFailure(this, {
            ...explainGenerationError({ code: "input_inaccessible", message: this.message }),
            reason: "文件已上传，但 Files 响应没有生成可引用地址",
            action: "请在连接的素材传输中选择对象存储或 HTTPS 链接。尚未提交生成。",
            message: this.message,
        });
    }
}

async function digestHex(value: BufferSource) {
    const digest = await crypto.subtle.digest("SHA-256", value);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function expireAt(file: FileInfo) {
    return Number.isFinite(file.expire_at) && Number(file.expire_at) > 0 ? file.expire_at : undefined;
}

function waitForFileProcessing(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("已停止等待", "AbortError"));
        };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 2000);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
    });
}

/**
 * Files 仅负责托管原文件；视频生成引用真实 HTTPS 地址，不把 file_id 当作 asset_id。
 * 上传与处理状态分开：GET 省略字段时不能丢弃同次 POST 已签发的链接。
 * https://console.volcengine.com/ark/region:cn-beijing/docs/upload-files-api
 */
export async function uploadArkFile(channel: ModelChannel, blob: Blob, name: string, kind: "image" | "video" | "audio", signal?: AbortSignal, progress?: (label: string, loaded: number, total: number) => void): Promise<string> {
    signal?.throwIfAborted();
    if (blob.size > (kind === "video" ? 200 : kind === "image" ? 30 : 15) * 1024 * 1024) throw new Error("参考素材超过当前视频模型的文件大小限制");
    if (kind === "video" && (!/\.(mp4|mov)$/i.test(name) || (blob.type && !["video/mp4", "video/quicktime"].includes(blob.type)))) throw new Error("方舟参考视频仅支持 MP4 / MOV");

    // 连接签名含凭证，只将其 SHA-256 写入键；文件按真实内容隔离，不以名称猜测复用。
    const [connectionHash, contentHash] = await Promise.all([
        digestHex(new TextEncoder().encode(channelConnectionSignature(channel))),
        blob.arrayBuffer().then(digestHex),
    ]);
    signal?.throwIfAborted();
    const receiptKey = `${scopedStorageKey("infinite-canvas:ark-file-receipts")}:${connectionHash}:${kind}:${contentHash}`;
    return navigator.locks.request(receiptKey, { signal }, async () => {
        signal?.throwIfAborted();
        const transport = createChannelTransport(channel, "video");
        let receipt = await receiptStore.getItem<FileReceipt>(receiptKey);
        if (receipt?.expire_at && receipt.expire_at * 1000 <= Date.now()) {
            // 仅清理本地过期回执；不删除云文件，也不迁移旧任务。
            await receiptStore.removeItem(receiptKey);
            receipt = null;
        }
        const reused = Boolean(receipt);
        let file: FileInfo;
        let downloadUrl = "";
        let latestGet: FileResponseDiagnostics | undefined;
        let queryCount = 0;

        const rememberLink = (info: FileInfo) => {
            if (typeof info.download_url === "string" && isReferenceHTTPSLink(info.download_url)) downloadUrl = info.download_url.trim();
        };
        const queryFile = async (): Promise<FileInfo> => {
            signal?.throwIfAborted();
            queryCount += 1;
            let observed: FileInfo;
            try {
                observed = await transport.get<FileInfo>(buildApiUrl(channel.baseUrl, `/files/${encodeURIComponent(receipt!.file_id)}`), { signal, timeout_ms: 20_000, validate_payload: false });
            } catch (error) {
                const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
                if (status === 404 || status === 410) {
                    await receiptStore.removeItem(receiptKey);
                    throw new Error(`方舟文件已不可用（文件 ID：${receipt!.file_id}）；本次未重新上传，尚未提交生成`);
                }
                throw error;
            }
            if (observed.id && observed.id !== receipt!.file_id) throw new Error("方舟返回的文件 ID 与查询文件不一致");
            latestGet = responseDiagnostics(observed);
            rememberLink(observed);
            const expiration = expireAt(observed);
            if (expiration !== undefined && expiration !== receipt!.expire_at) {
                receipt = { ...receipt!, expire_at: expiration };
                await receiptStore.setItem(receiptKey, receipt);
            }
            return observed;
        };

        if (receipt) {
            progress?.(`查询已上传的参考素材：${name}`, blob.size, blob.size);
            file = await queryFile();
        } else {
            signal?.throwIfAborted();
            const form = new FormData();
            // 此用途按官方契约请求原文件链接；不能假定响应一定包含该可选字段。
            form.append("purpose", "agent");
            form.append("file", blob, name);
            file = await transport.postForm<FileInfo>(buildApiUrl(channel.baseUrl, "/files"), form, { signal, timeout_ms: 180_000, on_upload_progress: (loaded, total) => progress?.(`上传参考素材：${name}`, loaded, total) });
            if (typeof file.id !== "string" || !/^file-[A-Za-z0-9_-]{1,128}$/.test(file.id)) throw new Error("方舟上传接口没有返回有效文件 ID");
            receipt = { file_id: file.id, expire_at: expireAt(file), post_response: responseDiagnostics(file) };
            // 先保存回执再处理状态；后续准备失败不能让重试再次上传同一份文件。
            try { await receiptStore.setItem(receiptKey, receipt); }
            catch { throw new Error(`方舟文件已上传，但本地回执保存失败（文件 ID：${receipt.file_id}）；请勿重复上传，尚未提交生成`); }
            rememberLink(file);
        }

        while (true) {
            signal?.throwIfAborted();
            if (file.status === "failed") throw new Error(file.error?.message || "参考素材处理失败");
            if (file.status === "active") {
                // 上传接口可能只确认 active，不包含原文件链接；必须先查详情，不能就地判失败。
                // 已复用回执或轮询得到的 active 已有 GET 证据，不因缺链接反复查询或重新上传。
                if (!downloadUrl && !latestGet) {
                    file = await queryFile();
                    continue;
                }
                if (!downloadUrl) throw new ArkFileReferenceError(receipt!.file_id, receipt!.post_response, latestGet, reused);
                return downloadUrl;
            }
            if (file.status !== "processing") throw new Error("方舟返回了未知的文件处理状态");
            if (queryCount >= MAX_FILE_QUERIES) throw new Error(`参考素材处理尚未完成（文件 ${receipt!.file_id}），请稍后查询；本次未重新上传`);
            progress?.(`方舟正在处理参考素材：${name}`, blob.size, blob.size);
            await waitForFileProcessing(signal);
            file = await queryFile();
        }
    });
}
