import { TaskDetailItem } from "@/pages/canvas/canvas-project-feedback";
import type { BrowserGenerationSubmission } from "@/services/browser-generation-tasks";

const PARAMETER_LABELS: Record<string, string> = {
    model: "提交模型",
    resolution: "分辨率",
    ratio: "画幅比例",
    duration: "时长（秒）",
    frames: "帧数",
    framespersecond: "帧率",
    seed: "随机种子",
    generate_audio: "同步音频",
    watermark: "水印",
    draft: "样片模式",
    draft_task_id: "参考样片任务 ID",
    return_last_frame: "返回尾帧",
    camera_fixed: "固定镜头",
    service_tier: "服务等级",
    priority: "优先级",
    execution_expires_after: "任务超时阈值（秒）",
    output_format: "输出格式",
};

/** 历史详情的只读信息区；仅展示调用方提供的安全字段和本地提交参数白名单。 */
export function GenerationHistoryDetails({ fields, submission, prompt, loading = false, error = false, emptyPromptMessage }: {
    fields: Array<{ label: string; value: string }>;
    submission?: BrowserGenerationSubmission;
    prompt?: string;
    loading?: boolean;
    error?: boolean;
    emptyPromptMessage: string;
}) {
    const savedPrompt = submission?.prompt ?? prompt;
    const parameters = Object.entries(PARAMETER_LABELS).flatMap(([key, label]) => {
        const value = submission?.parameters[key];
        if (typeof value !== "string" && typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) return [];
        const displayValue = typeof value === "boolean" ? value ? "开启" : "关闭"
            : key === "ratio" && value === "adaptive" ? "自适应"
            : key === "service_tier" && value === "default" ? "在线"
            : key === "service_tier" && value === "flex" ? "离线"
            : String(value);
        return [{ label, value: displayValue }];
    });

    return (
        <div className="generation-history-details flex min-w-0 flex-col gap-5">
            <section className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">提示词</h2>
                    {savedPrompt !== undefined ? <span className="text-xs text-foreground/45">本应用记录</span> : null}
                </div>
                {loading ? <p role="status" className="text-xs text-foreground/55">正在读取本地提交记录…</p> : savedPrompt?.trim() ? (
                    <div className="max-h-72 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-surface-hover p-3 text-xs leading-6">{savedPrompt}</div>
                ) : <p className="text-xs leading-6 text-foreground/55">{error ? "本地提交记录暂时无法读取，请关闭详情后重试。" : savedPrompt !== undefined ? "此任务未记录文字提示词。" : emptyPromptMessage}</p>}
            </section>
            <section className="min-w-0">
                <h2 className="mb-3 text-sm font-medium">任务信息</h2>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    {fields.map((field) => <TaskDetailItem key={field.label} label={field.label} value={field.value} />)}
                </div>
            </section>
            {parameters.length ? (
                <section className="min-w-0">
                    <h2 className="mb-3 text-sm font-medium">本应用提交参数</h2>
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        {parameters.map((field) => <TaskDetailItem key={field.label} label={field.label} value={field.value} />)}
                    </div>
                </section>
            ) : null}
        </div>
    );
}
