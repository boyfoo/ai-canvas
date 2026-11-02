import { useState } from "react";
import { Alert, Button, Popconfirm } from "antd";
import { isBrowserGenerationTask, promoteBrowserGenerationDraft } from "@/services/browser-generation-tasks";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";

export function BrowserDraftPromotion({ task }: { task: GenerationTask }) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<GenerationTask>();
    const [error, setError] = useState("");
    let draft = false;
    try {
        draft = JSON.parse(task.inputJson || "{}").parameters?.draft === true;
    } catch {
        /* 没有结构化参数的任务不提供此操作。 */
    }
    if (!isBrowserGenerationTask(task.id) || task.provider !== "ark-video" || task.status !== "succeeded" || !task.providerRequestId || !draft) return null;
    const promote = async () => {
        setBusy(true);
        setError("");
        try {
            const created = await promoteBrowserGenerationDraft(task.id);
            setResult(created);
            const completed = await waitForGenerationTask(created.id, { initialTask: created, onTaskUpdate: setResult });
            setResult(completed);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "样片转正式失败，请查看任务中心");
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="space-y-2 rounded-lg border border-[var(--workspace-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-medium">样片转正式</p>
                    <p className="mt-1 text-xs text-foreground/50">沿用原样片的提示词与素材，创建 1080p 正式视频任务。</p>
                </div>
                <Popconfirm
                    title="生成正式视频？"
                    description="将创建收费生成任务，费用由方舟收取。"
                    okText="生成正式视频"
                    cancelText="取消"
                    onConfirm={() => void promote()}
                >
                    <Button disabled={Boolean(result)} loading={busy}>
                        转为正式视频
                    </Button>
                </Popconfirm>
            </div>
            {result && (
                <p role="status" className="break-all text-xs">
                    正式视频任务：{result.id} ·{" "}
                    {result.status === "succeeded"
                        ? "生成完成，可在任务中心取回结果"
                        : result.status === "failed"
                          ? "生成失败，请查看该任务详情"
                          : "处理中，可在任务中心查看"}
                </p>
            )}
            {error && <Alert type="error" showIcon title={error} />}
        </section>
    );
}
