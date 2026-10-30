import { useState } from "react";
import { Alert, Button, Input } from "antd";
import { associateBrowserTask } from "@/services/browser-generation-tasks";

export function BrowserTaskAssociation({ taskId }: { taskId: string }) {
    const [id, setId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [linked, setLinked] = useState(false);
    const associate = async () => {
        setBusy(true); setError("");
        try { await associateBrowserTask(taskId, id.trim()); setLinked(true); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "关联任务失败"); }
        finally { setBusy(false); }
    };
    return <div className="space-y-2">
        <Alert type={linked ? "success" : "warning"} showIcon title={linked ? "已关联原任务，可查询或取回结果" : "提交结果未确认"} description={linked ? undefined : "在方舟控制台找到这次提交的任务，核对模型和提交时间后填入任务 ID。关联和查询不会重新生成。"} />
        {!linked && <div className="flex gap-2"><Input aria-label="关联方舟任务 ID" placeholder="cgt-..." value={id} onChange={event => setId(event.target.value)} disabled={busy} /><Button loading={busy} disabled={!id.trim()} onClick={() => void associate()}>关联原任务</Button></div>}
        {error && <p role="alert">{error}</p>}
    </div>;
}
