import { Form, Input, InputNumber, Select, Switch } from "antd";
import { ARK_VIDEO_MODELS, arkVideoModelProfile } from "@/lib/ark-video-models";
import type { ModelChannel } from "@/stores/use-config-store";

type Profile = NonNullable<ModelChannel["modelProfiles"]>[number];
export function ArkVideoOptionsEditor({ profile, onChange }: { profile: Profile; onChange: (patch: Partial<Profile>) => void }) {
    const options = profile.defaultOptions || {};
    const legacy = profile.provider_model_family?.startsWith("seedance10");
    const is25 = profile.provider_model_family === "seedance25";
    const patch = (key: string, value: unknown) => {
        const next = { ...options, [key]: value };
        if (value === undefined || value === "") delete next[key];
        onChange({ defaultOptions: next });
    };
    return <Form component="div" layout="vertical" requiredMark={false}>
        <Form.Item label="模型系列" help="自定义 Model ID / Endpoint ID 按实际模型选择；更改系列会重设模型能力和高级参数。"><Select aria-label="方舟视频模型系列" value={profile.provider_model_family} options={ARK_VIDEO_MODELS.map(item => ({ label: item.name, value: item.family }))} onChange={family => onChange({ ...arkVideoModelProfile(profile.model, family), defaultOptions: {} })} /></Form.Item>
        <div className="grid grid-cols-2 gap-x-4">
            <Form.Item label="返回尾帧"><Switch aria-label="返回尾帧" checked={options.return_last_frame === true} onChange={value => patch("return_last_frame", value)} /></Form.Item>
            {is25 && <Form.Item label="生成样片（480p）"><Switch aria-label="生成样片" checked={options.draft === true} onChange={value => patch("draft", value)} /></Form.Item>}
            {is25 && <Form.Item label="输出格式"><Select aria-label="视频输出格式" allowClear placeholder="服务默认值" value={options.output_format as string | undefined} options={[{ value: "mp4", label: "MP4" }, { value: "mov", label: "MOV" }]} onChange={value => patch("output_format", value)} /></Form.Item>}
            {legacy && <><Form.Item label="随机种子"><InputNumber aria-label="随机种子" min={-1} max={2147483647} precision={0} value={options.seed as number | undefined} onChange={value => patch("seed", value ?? undefined)} /></Form.Item><Form.Item label="固定镜头"><Switch aria-label="固定镜头" checked={options.camera_fixed === true} onChange={value => patch("camera_fixed", value)} /></Form.Item><Form.Item label="服务等级"><Select aria-label="服务等级" allowClear value={options.service_tier as string | undefined} options={[{ value: "default", label: "标准" }, { value: "flex", label: "离线推理" }]} onChange={value => patch("service_tier", value)} /></Form.Item></>}
            {!legacy && <Form.Item label="联网搜索"><Switch aria-label="视频联网搜索" checked={Array.isArray(options.tools) && options.tools.length > 0} onChange={value => patch("tools", value ? [{ type: "web_search" }] : undefined)} /></Form.Item>}
            <Form.Item label="优先级（0–9）"><InputNumber aria-label="视频任务优先级" min={0} max={9} precision={0} value={options.priority as number | undefined} onChange={value => patch("priority", value ?? undefined)} /></Form.Item>
            <Form.Item label="任务有效期（秒）"><InputNumber aria-label="视频任务有效期" min={3600} max={259200} precision={0} value={options.execution_expires_after as number | undefined} onChange={value => patch("execution_expires_after", value ?? undefined)} /></Form.Item>
        </div>
        {is25 && <Form.Item label="样片任务 ID（转正式）" help="填写后仅使用原样片生成正式视频，输出固定 1080p；提示词和参考素材沿用原样片。完成后清空此项可恢复普通生成。"><Input aria-label="样片任务 ID" placeholder="cgt-..." value={String(options.draft_task_id || "")} onChange={event => patch("draft_task_id", event.target.value.trim())} /></Form.Item>}
        <Form.Item label="安全标识（可选）"><Input aria-label="视频安全标识" maxLength={64} value={String(options.safety_identifier || "")} onChange={event => patch("safety_identifier", event.target.value)} /></Form.Item>
        <p className="text-xs text-foreground/60">高级参数用于此连接的当前模型。比例、时长、分辨率、声音和水印在画布视频设置中调整。本地参考视频在生成时会上传至方舟 Files 存储。</p>
    </Form>;
}
