import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { ArrowLeft, Cloud, Play, RefreshCw, Video, VideoOff } from "lucide-react";
import { useNavigate } from "react-router";

import { CollectionGrid, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { AppModal } from "@/components/ui/product/app-modal";
import { VideoPlayer } from "@/components/video-player";
import { servicePresetFor } from "@/lib/model-service-presets";
import { channelConnectionSignature, channelHasGenerationCredential, useEffectiveConfig, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { listArkVideoHistory, type ArkVideoHistoryTask } from "@/services/providers/ark-video-history";
import { listBrowserGenerationSubmissions, type BrowserGenerationSubmission } from "@/services/browser-generation-tasks";
import { GenerationHistoryDetails } from "./generation-history-details";
import "./ark-generation-history.css";

const STATUS_LABELS: Record<string, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
    expired: "任务超时",
};
const STATUS_OPTIONS = [{ value: "all", label: "全部状态" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))];

function httpsMediaUrl(value?: string): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
    } catch {
        return undefined;
    }
}

function taskTime(value?: number): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) return "—";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function cloudTaskFields(task: ArkVideoHistoryTask) {
    const values: Array<[string, unknown]> = [
        ["任务 ID", task.id], ["模型", task.model], ["状态", STATUS_LABELS[task.status] || task.status],
        ["创建时间", taskTime(task.created_at)], ["更新时间", taskTime(task.updated_at)],
        ["任务类型", task.draft === true ? "样片" : "正式视频"],
        ["时长（秒）", task.duration], ["分辨率", task.resolution], ["画幅比例", task.ratio],
        ["帧率", task.framespersecond], ["帧数", task.frames], ["随机种子", task.seed],
        ["同步音频", task.generate_audio], ["输出格式", task.output_format],
        ["服务等级", task.service_tier === "default" ? "在线" : task.service_tier === "flex" ? "离线" : task.service_tier], ["优先级", task.priority],
        ["任务超时阈值（秒）", task.execution_expires_after],
        ["生成 Token", task.usage?.completion_tokens], ["总 Token", task.usage?.total_tokens],
        ["联网搜索次数", task.usage?.tool_usage?.web_search],
        ["错误码", task.error?.code], ["错误信息", task.error?.message],
    ];
    return values.flatMap(([label, value]) => {
        if (typeof value === "boolean") return [{ label, value: value ? "开启" : "关闭" }];
        if (typeof value === "string" && value.trim()) return [{ label, value }];
        if (typeof value === "number" && Number.isFinite(value)) return [{ label, value: String(value) }];
        return [];
    });
}

function ArkTaskCard({ task, submission, onPreview }: { task: ArkVideoHistoryTask; submission?: BrowserGenerationSubmission; onPreview: (task: ArkVideoHistoryTask) => void }) {
    const videoUrl = task.status === "succeeded" ? httpsMediaUrl(task.content?.video_url) : undefined;
    const imageUrl = httpsMediaUrl(task.content?.last_frame_url);
    const [failedImage, setFailedImage] = useState<string>();
    const [failedVideo, setFailedVideo] = useState<string>();
    const canPreview = Boolean(videoUrl);
    const showVideo = Boolean(videoUrl && failedVideo !== videoUrl);
    const showImage = Boolean(imageUrl && imageUrl !== failedImage);
    const unavailable = task.status === "succeeded" && !canPreview;
    const mediaLabel = canPreview ? `预览视频 ${task.id}` : unavailable ? "视频暂不可用" : STATUS_LABELS[task.status] || task.status;

    return (
        <article className="ark-generation-history-card">
            <button type="button" className="ark-generation-history-media" disabled={!canPreview} onClick={() => onPreview(task)} aria-label={mediaLabel}>
                {showImage ? (
                    <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(imageUrl)} />
                ) : showVideo ? (
                    <video src={videoUrl} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} onError={() => setFailedVideo(videoUrl)} />
                ) : (
                    <span className="ark-generation-history-placeholder">
                        {canPreview ? <Play size={24} /> : unavailable ? <VideoOff size={24} /> : <Video size={24} />}
                        <span>{canPreview ? "点击预览视频" : mediaLabel}</span>
                    </span>
                )}
                {canPreview && (showImage || showVideo) ? <span className="ark-generation-history-play"><Play size={19} fill="currentColor" /></span> : null}
                {showImage && unavailable ? <span className="ark-generation-history-unavailable">视频暂不可用</span> : null}
                <span className="ark-generation-history-status" data-status={task.status}>{STATUS_LABELS[task.status] || task.status}</span>
            </button>
            <div className="ark-generation-history-card-body">
                <div className="ark-generation-history-model-row">
                    <strong title={task.model}>{task.model || "未知模型"}</strong>
                    {task.draft ? <span className="ark-generation-history-draft">样片</span> : null}
                </div>
                <code className="ark-generation-history-task-id" title={task.id}>{task.id}</code>
                <p className="ark-generation-history-prompt" title={submission?.prompt}>{submission ? submission.prompt.trim() || "未填写文字提示词" : "提示词未记录"}</p>
                <div className="ark-generation-history-specs">
                    {typeof task.duration === "number" && Number.isFinite(task.duration) && task.duration > 0 ? <span>{task.duration} 秒</span> : null}
                    {task.resolution ? <span>{task.resolution}</span> : null}
                    {task.ratio ? <span>{task.ratio}</span> : null}
                </div>
                <div className="ark-generation-history-time"><span>创建</span><time>{taskTime(task.created_at)}</time></div>
                {task.updated_at && task.updated_at !== task.created_at ? <div className="ark-generation-history-time"><span>更新</span><time>{taskTime(task.updated_at)}</time></div> : null}
                {task.error?.message || task.error?.code ? <p className="ark-generation-history-task-error" title={task.error.message || task.error.code}>{task.error.message || task.error.code}</p> : null}
                <Button type="text" className="ark-generation-history-details-button" onClick={() => onPreview(task)}>查看详情</Button>
            </div>
        </article>
    );
}

function ArkChannelHistory({ channel, queryIdentity, userId }: { channel: ModelChannel; queryIdentity: string; userId: string }) {
    const [status, setStatus] = useState("all");
    const [searchValue, setSearchValue] = useState("");
    const [taskId, setTaskId] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [preview, setPreview] = useState<ArkVideoHistoryTask | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [previewReady, setPreviewReady] = useState(false);
    const query = useQuery({
        queryKey: ["ark-video-history", userId, channel.id, queryIdentity, status, taskId, page, pageSize],
        queryFn: ({ signal }) => listArkVideoHistory(channel, { page_num: page, page_size: pageSize, status: status === "all" ? undefined : status, task_id: taskId || undefined }, signal),
        staleTime: 30_000,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
    });
    const providerTaskIds = query.data?.items.map((task) => task.id) || [];
    const submissions = useQuery({
        queryKey: ["ark-video-history-submissions", userId, channel.id, queryIdentity, providerTaskIds],
        queryFn: ({ signal }) => listBrowserGenerationSubmissions(channel, providerTaskIds, signal),
        enabled: providerTaskIds.length > 0,
        staleTime: 30_000,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
    });
    const search = (value: string) => {
        const nextTaskId = value.trim();
        setSearchValue(nextTaskId);
        setPreview(null);
        setPage(1);
        setTaskId(nextTaskId);
        if (nextTaskId === taskId && page === 1) void query.refetch();
    };
    const videoUrl = preview?.status === "succeeded" ? httpsMediaUrl(preview.content?.video_url) : undefined;
    const queryableTotal = Math.min(query.data?.total || 0, pageSize * 500);

    useEffect(() => {
        if (!preview || !videoUrl || previewReady || previewFailed) return;
        const timeout = window.setTimeout(() => setPreviewFailed(true), 20_000);
        return () => window.clearTimeout(timeout);
    }, [preview, videoUrl, previewReady, previewFailed]);

    return (
        <>
            <div className="ark-generation-history-filters">
                <Select aria-label="任务状态" className="ark-generation-history-status-filter" value={status} options={STATUS_OPTIONS} onChange={(value) => { setStatus(value); setPage(1); setPreview(null); }} />
                <Input.Search aria-label="按任务 ID 搜索" className="ark-generation-history-search" placeholder="输入任务 ID" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} onSearch={search} allowClear enterButton="查询" />
                <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => { setPreview(null); void query.refetch(); }}>刷新</Button>
                {query.data ? <span className="ark-generation-history-total" aria-live="polite">共 {query.data.total} 条任务</span> : null}
            </div>
            {query.isPending ? <WorkspaceLoadingState label="正在读取火山云端任务" rows={6} /> : query.isError ? (
                <WorkspaceErrorState title="无法读取火山云端任务" description={query.error instanceof Error ? query.error.message : "请检查连接配置和网络后重试。"} onRetry={() => { void query.refetch(); }} />
            ) : query.data.items.length === 0 ? (
                <WorkspaceState title={taskId || status !== "all" ? "没有符合条件的任务" : "暂无云端任务"} description={taskId || status !== "all" ? "请调整任务 ID 或状态后查询。" : "此连接下暂无云端仍保留的在线视频任务。"} />
            ) : (
                <CollectionGrid className="ark-generation-history-grid">
                    {query.data.items.map((task) => <ArkTaskCard key={`${task.id}:${query.dataUpdatedAt}`} task={task} submission={submissions.data?.[task.id]} onPreview={(item) => { setPreviewFailed(false); setPreviewReady(false); setPreview(item); }} />)}
                </CollectionGrid>
            )}
            {query.data && !query.isError ? (
                <>
                    {query.data.total > queryableTotal ? <p className="ark-generation-history-page-limit">云端最多支持查询前 500 页，当前每页 {pageSize} 条，可查询前 {queryableTotal} 条任务。可筛选状态或搜索任务 ID 缩小范围。</p> : null}
                    <PaginationBar current={page} pageSize={pageSize} total={queryableTotal} alwaysShow itemLabel={query.data.total > queryableTotal ? "条可查询任务" : "条"} pageSizeOptions={[20, 50, 100]} onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); setPreview(null); }} />
                </>
            ) : null}
            <AppModal open={Boolean(preview)} title="生成任务详情" footer={null} width={1120} onCancel={() => setPreview(null)} className="ark-generation-history-preview">
                {preview ? (
                    <div className="ark-generation-history-detail-layout">
                        <div className="ark-generation-history-detail-media">
                            {preview.status !== "succeeded" ? <WorkspaceState compact title={STATUS_LABELS[preview.status] || preview.status} description={preview.error?.message || "此任务暂无可预览的视频结果。"} /> : previewFailed || !videoUrl ? <WorkspaceState compact icon="error" title="视频暂不可用" description="链接可能已失效，或当前网络无法读取视频。任务信息仍可查看。" /> : <VideoPlayer key={videoUrl} src={videoUrl} title={preview.id} autoPlay={false} onCanPlay={() => setPreviewReady(true)} onError={() => setPreviewFailed(true)} />}
                        </div>
                        <GenerationHistoryDetails
                            fields={cloudTaskFields(preview)}
                            submission={submissions.data?.[preview.id]}
                            loading={submissions.isFetching && !submissions.data}
                            error={submissions.isError}
                            emptyPromptMessage="没有找到此连接下的本地提交记录。火山查询接口不返回原始提示词。"
                        />
                    </div>
                ) : null}
            </AppModal>
        </>
    );
}

/** 素材页中的云端只读历史；远程任务不写入本地素材或关联画布。 */
export function ArkGenerationHistory({ onBack, sourceSwitcher, sourceNavigation }: { onBack: () => void; sourceSwitcher: ReactNode; sourceNavigation: ReactNode }) {
    const config = useEffectiveConfig();
    const userId = useUserStore((state) => state.user?.id || "");
    const hydrated = useUserStore((state) => state.hydrated);
    const navigate = useNavigate();
    const [selectedId, setSelectedId] = useState<string>();
    const channels = useMemo(() => config.channels.filter((channel) => channel.enabled !== false && ["ark", "ark-video"].includes(servicePresetFor(channel))), [config.channels]);
    const channel = channels.find((item) => item.id === selectedId) || channels.find((item) => channelHasGenerationCredential(item)) || channels[0];
    const signature = channel ? channelConnectionSignature(channel) : "";
    // Signature 仅用于比较配置变化，含凭证的原文不进入 React Query key 或元数据。
    const connection = useMemo(() => ({ userId, channelId: channel?.id, signature, queryIdentity: crypto.randomUUID() }), [userId, channel?.id, signature]);
    const settingsAction = <Button onClick={() => navigate("/settings?section=channels")}>管理模型连接</Button>;

    return (
        <WorkspacePage grid className="library-page assets-library-page canvas-library-page generation-history-page ark-generation-history-page">
            <div className="studio-band assets-library-hero">
                <PageHeader title="生成历史" description="查看所选连接在火山方舟云端的在线视频任务。" leading={<Button type="text" icon={<ArrowLeft size={17} />} aria-label="返回素材库" onClick={onBack} />} actions={sourceSwitcher} />
            </div>
            <section className="ark-generation-history-content" aria-label="火山云端生成历史">
                <div className="ark-generation-history-connection">
                    <Cloud size={16} aria-hidden="true" />
                    <label htmlFor="ark-generation-history-channel">模型连接</label>
                    <Select id="ark-generation-history-channel" className="ark-generation-history-channel" placeholder="选择火山方舟连接" value={channel?.id} options={channels.map((item) => ({ value: item.id, label: item.name }))} onChange={setSelectedId} disabled={!hydrated || !userId || channels.length === 0} />
                    <span className="ark-generation-history-hint">仅展示云端仍保留的任务；结果链接可能失效。</span>
                </div>
                {!hydrated ? <WorkspaceLoadingState label="正在加载模型连接" /> : !userId ? <WorkspaceState title="请先登录" description="登录后可查看自己的模型连接与云端任务。" /> : !channel ? (
                    <WorkspaceState title="还没有火山方舟连接" description="在设置中添加火山方舟或火山方舟（视频版）连接后，即可查询云端任务。" action={settingsAction} />
                ) : !channelHasGenerationCredential(channel) || !channel.baseUrl.trim() ? (
                    <WorkspaceState title="请完善模型连接" description="请在设置中保存此连接的服务地址和 API Key。" action={settingsAction} />
                ) : <ArkChannelHistory key={connection.queryIdentity} channel={channel} queryIdentity={connection.queryIdentity} userId={userId} />}
            </section>
            {sourceNavigation}
        </WorkspacePage>
    );
}
