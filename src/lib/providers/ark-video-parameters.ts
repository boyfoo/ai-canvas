import type { GenerationParameterField, ProviderGenerationParameters, ProviderParameterContext } from "@/lib/generation-parameter-types";
import { arkVideoOperations } from "./ark-video-operations";

// 官方契约：https://console.volcengine.com/ark/region:cn-beijing/docs/create-video-generation-task-api
// 模型限制集中于此；设置页和画布不能再维护 Seedance 参数白名单或业务联动。
function fields(context: ProviderParameterContext): GenerationParameterField[] {
    const { profile, operation } = context;
    const family = profile.provider_model_family;
    if (!family) return [];
    const legacy = family.startsWith("seedance10");
    const result: GenerationParameterField[] = [{ key: "return_last_frame", label: "返回尾帧", type: "boolean", recommended: false }];
    if (family === "seedance25") {
        result.push(
            { key: "draft", label: "生成样片", type: "boolean", recommended: false, forces: { vquality: "480p" }, help: "样片固定使用 480p；完成后可在任务详情转为正式视频。" },
            {
                key: "output_format",
                label: "输出格式",
                type: "select",
                options: [
                    { value: "mp4", label: "MP4" },
                    { value: "mov", label: "MOV" },
                ],
            },
        );
    }
    if (legacy)
        result.push(
            { key: "frames", label: "输出帧数", type: "number", min: 29, max: 289, step: 4, summary: (value) => `${value} 帧`, help: "可选 29、33…289 帧（24 帧/秒）。填写后按帧数生成；清空后按秒数生成。" },
            { key: "seed", label: "随机种子", type: "number", min: -1, max: 2147483647, step: 1, help: "-1 表示随机。" },
            { key: "camera_fixed", label: "固定镜头", type: "boolean", recommended: false, hidden: Boolean(operation && operation !== "reference_to_video"), help: "仅用于参考生成中的纯文字输入。" },
            {
                key: "service_tier",
                label: "服务等级",
                type: "select",
                options: [
                    { value: "default", label: "标准" },
                    { value: "flex", label: "离线推理" },
                ],
            },
        );
    else
        result.push(
            {
                key: "tools",
                label: "联网搜索",
                type: "boolean",
                recommended: false,
                read: (value) => Array.isArray(value) && value.length > 0,
                write: (value) => (value === true ? [{ type: "web_search" }] : undefined),
                validate: (value) => (!Array.isArray(value) || !value.length || value.some((tool) => !tool || typeof tool !== "object" || tool.type !== "web_search") ? "视频工具仅支持联网搜索" : undefined),
            },
            // priority 仅 2.5 / 2.0 支持；1.0 的 default / flex 均不支持。
            { key: "priority", label: "任务优先级", type: "number", min: 0, max: 9, step: 1, help: "同一 Endpoint 内，数值越大优先级越高。" },
        );
    result.push(
        {
            key: "callback_url",
            label: "状态回调地址",
            type: "text",
            help: "可选。方舟向此服务地址发送 POST 通知；浏览器仍轮询任务状态，无需填写本页面地址。",
            validate: (value) => {
                try {
                    const url = new URL(String(value));
                    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash) return undefined;
                } catch {
                    /* 只接受能接收回调的完整 HTTP(S) 地址。 */
                }
                return "回调地址需为不含账号或片段的完整 HTTP(S) 地址";
            },
        },
        { key: "execution_expires_after", label: "任务有效期（秒）", type: "number", min: 3600, max: 259200, step: 1 },
        { key: "safety_identifier", label: "安全标识", type: "text", maxLength: 64, validate: (value) => (!/^[\x21-\x7E]{1,64}$/.test(String(value)) ? "安全标识需为 1–64 位无空格的 ASCII 字符" : undefined) },
    );
    // 转正式沿用样片内容，只接受任务控制和输出选项，不能再次发送 draft、tools 等生成选项。
    if (operation === "draft_promotion") {
        const allowed = new Set(["return_last_frame", "output_format", "priority", "callback_url", "execution_expires_after", "safety_identifier"]);
        return result.map((field) => ({ ...field, hidden: !allowed.has(field.key) }));
    }
    return result;
}

export const arkVideoGenerationParameters: ProviderGenerationParameters = {
    operations: arkVideoOperations,
    defaultOperation: () => "reference_to_video",
    fields,
    constrainCommon(common, context) {
        const family = context.profile.provider_model_family;
        const legacy = family?.startsWith("seedance10");
        const mode = arkVideoOperations(context).find((item) => item.value === context.operation);
        return common.map((field) => {
            const fixed = mode?.forces?.[field.key];
            if (fixed !== undefined) {
                const automatic = mode!.value === "omni_auto";
                let label = fixed;
                if (field.key === "size") label = automatic ? "模型自动适配" : mode!.referenceMode === "frames" ? "随首帧图片" : "随原视频";
                if (field.key === "videoSeconds") label = automatic ? "模型自动决定" : "随原视频时长";
                return { ...field, forcedValue: fixed, disabled: `由「${mode!.label}」固定`, ...(field.type === "select" ? { options: [{ value: fixed, label }] } : {}), ...(field.key === "videoSeconds" ? { summary: () => label } : {}) };
            }
            if (field.key === "videoSeconds") {
                if (legacy && context.values.frames !== undefined) return { ...field, hidden: true };
            }
            if (field.key === "size") {
                if (legacy && context.operation === "reference_to_video") return { ...field, options: field.options?.filter((option) => option.value !== "adaptive") };
            }
            return field;
        });
    },
    validate(context) {
        if (context.operation && context.operation !== "draft_promotion" && context.references) {
            const mode = arkVideoOperations(context).find((item) => item.value === context.operation);
            if (!mode) return "当前模型不支持所选视频生成模式，请重新选择";
            if (mode.inputIssue) return mode.inputIssue;
        }
        if (context.profile.provider_model_family === "seedance25" && context.operation === "inpaint" && context.references?.videoDurationsMs?.some((ms) => ms > 0 && (ms < 4000 || ms > 30000))) return "视频编辑任务的参考视频时长需为 4–30 秒";
        return undefined;
    },
};
