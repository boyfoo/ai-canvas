import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { modelCatalogRequestURL } from "@/lib/model-service-presets";
import { defaultModelDirectTestRequest, testModelDirectConnection, type DirectTestRequest, type DirectTestResult } from "@/services/api/model-direct-test";
import type { ModelChannel } from "@/stores/use-config-store";

export function ModelDirectTestModal({ channel, onClose }: { channel: ModelChannel; onClose: () => void }) {
    const [request, setRequest] = useState(() => defaultModelDirectTestRequest(channel));
    const [result, setResult] = useState<DirectTestResult | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const running = useRef<AbortController | null>(null);
    useEffect(() => () => { const current = running.current; running.current = null; current?.abort(); }, []);
    const patch = (value: Partial<DirectTestRequest>) => { setRequest(current => ({ ...current, ...value })); setResult(null); setError(""); };
    const send = async () => {
        if (running.current) return;
        const controller = new AbortController();
        running.current = controller;
        setBusy(true); setResult(null); setError("");
        try {
            const response = await testModelDirectConnection(channel, request, { signal: controller.signal });
            if (running.current === controller) setResult(response);
        } catch (failure) {
            if (running.current === controller) setError(failure instanceof Error ? failure.message : "无法发起测试");
        } finally {
            if (running.current === controller) { running.current = null; setBusy(false); }
        }
    };
    const received = result?.outcome === "response";
    const title = !result ? "" : received ? `已收到 HTTP ${result.http_status} 响应` : result.outcome === "timeout" ? "请求超时" : result.outcome === "cancelled" ? "已停止等待" : "浏览器未读到服务响应";
    const description = !result ? "" : received ? "浏览器可以读取本次请求的响应。请结合 HTTP 状态和响应内容判断接口、密钥是否正确；其他接口和请求方法需分别测试。" : result.outcome === "network_error" ? "可能是 CORS 拦截、网络或 TLS 问题。请在浏览器开发者工具的 Console 和 Network 中查看具体原因。" : result.outcome === "timeout" ? "20 秒内未完成。已提交的 POST 请求可能仍在服务端执行，请先查询任务再决定是否重发。" : result.method === "POST" ? "只停止了浏览器等待，已提交的请求可能继续在服务端执行。" : "本次浏览器请求已取消。";
    const tone = received ? result.http_status! >= 200 && result.http_status! < 300 ? "success" : "warning" : result?.outcome === "network_error" ? "error" : "info";
    let body = result?.body_excerpt || "（响应体为空）";
    if (received) { try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* 原样显示文本或截断后的 JSON。 */ } }

    return <AppModal open centered width={720} title="测试浏览器直连" onCancel={onClose} footer={<div className="flex flex-wrap justify-end gap-2"><Button aria-label="关闭直连测试" onClick={onClose}>关闭</Button>{busy ? <Button onClick={() => running.current?.abort()}>停止等待</Button> : <Button type="primary" onClick={() => void send()}>发送直连请求</Button>}</div>}>
        <p className="mb-4 text-sm leading-6 text-foreground/65">使用当前连接的 API Key 和自定义请求头，由浏览器直接请求以下地址。默认 GET 只读取数据，不创建生成任务。</p>
        <Form layout="vertical" requiredMark={false} disabled={busy}>
            <div className="mb-3 flex flex-wrap gap-2"><Button size="small" disabled={busy} onClick={() => patch(defaultModelDirectTestRequest(channel))}>默认读取接口</Button>{channel.provider_id !== "ark-video" && <Button size="small" disabled={busy} onClick={() => patch({ url: modelCatalogRequestURL(channel), method: "GET" })}>模型目录接口</Button>}</div>
            <Form.Item label="请求地址"><Input aria-label="直连请求地址" value={request.url} onChange={event => patch({ url: event.target.value })} /></Form.Item>
            <Form.Item label="请求方法"><Select aria-label="直连请求方法" value={request.method} options={[{ value: "GET", label: "GET · 读取" }, { value: "POST", label: "POST · 提交 JSON" }]} onChange={method => patch({ method })} /></Form.Item>
            {request.method === "POST" && <><Alert className="mb-3" type="warning" showIcon title="POST 会真实调用所填接口；生成请求可能产生费用。请填写准确的请求体后发送。" /><Form.Item label="JSON 请求体"><Input.TextArea aria-label="直连 JSON 请求体" autoSize={{ minRows: 5, maxRows: 12 }} value={request.body} onChange={event => patch({ body: event.target.value })} /></Form.Item></>}
        </Form>
        {error && <Alert role="alert" type="error" showIcon title={error} />}
        {result && <section aria-label="直连测试结果" className="space-y-3">
            <Alert role="status" type={tone} showIcon title={title} description={description} />
            <div className="break-all text-xs leading-6 text-foreground/65">{result.method} {result.request_url}<br />耗时：{result.duration_ms} 毫秒{result.content_type ? ` · ${result.content_type}` : ""}</div>
            {received && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-active p-3 text-xs" aria-label="直连响应内容">{body}</pre>{result.truncated && <p className="text-xs text-foreground/55">响应较长，仅显示前 16 KiB。</p>}</>}
        </section>}
    </AppModal>;
}
