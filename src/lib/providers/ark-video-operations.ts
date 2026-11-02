import type { GenerationOperationDefinition, ProviderParameterContext } from "@/lib/generation-parameter-types";

/** API 中编辑和延长是全模态参考的子任务，不是额外的 /edit 或 /extend 接口。
 * inpaint 是画布既有的编辑操作标识；在方舟中映射通用视频编辑，并不要求遮罩。
 */
export function arkVideoOperations(context: ProviderParameterContext): GenerationOperationDefinition[] {
    const family = context.profile.provider_model_family;
    if (!family) return [];
    const legacy = family.startsWith("seedance10");
    const is25 = family === "seedance25";
    const maxFrames = family === "seedance10fast" ? 1 : 2;
    const refs = context.references;
    const images = refs?.imageCount || 0;
    const videos = refs?.videoCount || 0;
    const audios = refs?.audioCount || 0;
    const total = images + videos + audios;
    const modes: GenerationOperationDefinition[] = [
        {
            value: "reference_to_video",
            label: "参考生成",
            referenceMode: legacy ? "none" : "all",
            help: legacy ? "直接输入文字生成视频；使用图片时请选择首帧或首尾帧模式。" : is25 ? "可只输入文字，也可组合图片、视频、音频生成新视频，支持仅使用音频。" : "可只输入文字，也可组合图片、视频、音频生成新视频；音频需搭配图片或视频。",
            inputIssue: refs && legacy && total ? "当前模型的参考生成仅支持文字，使用图片请选择首帧或首尾帧模式" : refs && !legacy && !is25 && audios && !images && !videos ? "参考音频需搭配图片或视频" : undefined,
            // 文生只传 text 内容；有全模态素材时才引导参考子任务，不改变用户选择的模式。
            ...(is25 && total > 0 ? { requestOptions: { omni_reference_task_type: "reference" } } : {}),
        },
        {
            value: "image_to_video",
            label: maxFrames === 1 ? "首帧生视频" : "首帧 / 首尾帧",
            referenceMode: "frames",
            frameCount: maxFrames,
            help: maxFrames === 1 ? "使用一张首帧图片生成视频，不能混用视频或音频。" : `一张图作为首帧，两张图分别作为首尾帧；不能混用视频或音频。${is25 ? "视频比例跟随首帧图片。" : ""}`,
            inputIssue: refs && (!images || images > maxFrames || videos || audios) ? `需要 1${maxFrames > 1 ? "–2" : ""} 张图片，且不能混用视频或音频` : undefined,
            ...(is25 ? { forces: { size: "adaptive" } } : {}),
        },
    ];
    if (!legacy)
        modes.push(
            {
                value: "inpaint",
                label: "视频编辑",
                referenceMode: "all",
                help: is25 ? "需要 4–30 秒参考视频，在提示词中描述画面或声音的修改目标；比例和时长跟随原视频。" : "连接要修改的视频，在提示词中描述画面或声音的修改目标；可同时添加参考图片或音频。",
                promptPrefix: "请编辑参考视频，按照以下要求修改画面或声音：",
                inputIssue: refs && !videos ? "请添加要修改的视频" : undefined,
                ...(is25 ? { requestOptions: { omni_reference_task_type: "edit" }, forces: { size: "adaptive", videoSeconds: "-1" } } : {}),
            },
            {
                value: "extend",
                label: "视频延长",
                referenceMode: "all",
                help: `连接要延长的视频，说明向前或向后延长及新增内容。${is25 ? "视频比例跟随原片，生成时长可设置。" : ""}`,
                promptPrefix: "请延长参考视频，按照以下要求生成延长部分：",
                inputIssue: refs && !videos ? "请添加要延长的视频" : undefined,
                ...(is25 ? { requestOptions: { omni_reference_task_type: "extend" }, forces: { size: "adaptive" } } : {}),
            },
        );
    if (is25)
        modes.unshift({
            value: "omni_auto",
            label: "自动判断",
            referenceMode: "all",
            help: "由火山根据素材和提示词判断参考生成、视频编辑或视频延长；含参考视频时，比例和时长由模型自动适配。严格指定首尾帧请使用首帧 / 首尾帧模式。",
            requestOptions: { omni_reference_task_type: "auto" },
            // 子任务由服务端判断，不在前端猜测。有视频时覆盖编辑的最严格参数要求，避免判为编辑后因比例或时长异步失败。
            ...(videos > 0 ? { forces: { size: "adaptive", videoSeconds: "-1" } } : {}),
        });
    return modes;
}
