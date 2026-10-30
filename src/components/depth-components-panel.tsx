import { useCallback, useEffect, useState } from "react";
import { Button, type App } from "antd";
import { getCanvasHostServices, type DepthServiceState } from "@/services/canvas-host";
import { navigateToSettings } from "@/lib/settings-navigation";

export function DepthComponentsPanel({ initialState, onReady, onCancel, onOpenSettings }: {
    initialState?: DepthServiceState;
    onReady?: () => void;
    onCancel?: () => Promise<void>;
    onOpenSettings?: () => void;
}) {
    const [state, setState] = useState(initialState);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const refresh = useCallback(async (signal?: AbortSignal) => {
        setBusy(true);
        try {
            const next = await getCanvasHostServices().getDepthStatus({ signal });
            if (signal?.aborted) return;
            if (next.status !== "ready" && next.status !== "unavailable") throw new Error("深度服务返回了无效的状态");
            setState(next);
            setError("");
        } catch (cause) {
            if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        } finally { if (!signal?.aborted) setBusy(false); }
    }, []);
    useEffect(() => {
        if (initialState) return;
        const controller = new AbortController();
        void refresh(controller.signal);
        return () => controller.abort();
    }, [initialState, refresh]);
    useEffect(() => { if (state?.status === "ready") onReady?.(); }, [state?.status, onReady]);

    return <div className="space-y-3 text-sm" data-canvas-no-zoom data-canvas-wheel-scroll>
        <p className="leading-6 text-foreground/70">深度动作捕捉由工作区连接的处理服务执行。</p>
        <p role="status">{state?.status === "ready" ? "服务已就绪，可以使用" : state?.detail || (state ? "服务尚未就绪" : error ? "暂时无法读取服务状态" : "正在检查服务…")}</p>
        {state?.engine ? <p className="text-foreground/60">处理引擎：{state.engine}</p> : null}
        {error ? <p role="alert" className="break-words text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => void refresh()}>重新检查</Button>
            {onOpenSettings ? <Button onClick={onOpenSettings}>查看服务设置</Button> : null}
            {onCancel ? <Button onClick={() => void onCancel()}>返回</Button> : null}
        </div>
    </div>;
}

type ModalAPI = ReturnType<typeof App.useApp>["modal"];

export async function confirmDepthComponents(modal: ModalAPI): Promise<boolean> {
    const state = await getCanvasHostServices().getDepthStatus();
    if (state.status === "ready") return true;
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (allowed: boolean) => { if (!settled) { settled = true; resolve(allowed); } };
        const cancel = async () => { finish(false); dialog.destroy(); };
        const dialog = modal.confirm({
            title: "检查深度动作捕捉服务", centered: true, closable: true, maskClosable: false, width: 560, footer: null, icon: null,
            content: <DepthComponentsPanel initialState={state}
                onReady={() => { finish(true); dialog.destroy(); }} onCancel={cancel}
                onOpenSettings={() => { finish(false); dialog.destroy(); navigateToSettings({ section: "storage" }); }} />,
            onCancel: cancel,
        });
    });
}
