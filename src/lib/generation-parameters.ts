import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { audioSpeechProfile } from "@/lib/audio-generation";
import { modelProviderDefinition, providerPresetModelProfile } from "@/lib/model-service-presets";
import { providerGenerationDefinition } from "@/lib/providers/generation-providers";
import type { GenerationParameterField, GenerationParameterInput, ProviderParameterContext } from "@/lib/generation-parameter-types";
import { modelOptionName, resolveModelChannel, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export type ModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];
export type GenerationConfigKey =
    | "size"
    | "quality"
    | "count"
    | "transparentBackground"
    | "videoSeconds"
    | "vquality"
    | "videoGenerateAudio"
    | "videoWatermark"
    | "audioVoice"
    | "audioFormat"
    | "audioSpeed"
    | "audioPitch"
    | "audioVolume"
    | "audioInstructions"
    | "seedreamMode"
    | "seedreamMaxImages"
    | "seedreamOutputFormat"
    | "seedreamOptimize"
    | "seedreamWatermark";
export type GenerationDefaults = Partial<Record<GenerationConfigKey, string>>;

const selectOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

export function commonGenerationFields(profile: ModelProfile): GenerationParameterField[] {
    const capability = profile.capabilityConfig || defaultModelCapabilityConfig(profile.protocol, profile.model);
    if (profile.capability === "video" && capability.video) {
        const video = capability.video;
        return [
            ...(video.ratios.length ? [{ key: "size", label: "比例", type: "select" as const, options: selectOptions(video.ratios), recommended: video.defaultRatio }] : []),
            ...(video.resolutions.length
                ? [
                      {
                          key: "vquality",
                          label: "分辨率",
                          type: "select" as const,
                          options: selectOptions(video.resolutions),
                          recommended: video.defaultResolution,
                      },
                  ]
                : []),
            ...(video.durationSupported === false || (video.duration.selection === "enum" && !video.duration.values?.length)
                ? []
                : [
                      video.duration.selection === "enum"
                          ? {
                                key: "videoSeconds",
                                label: "时长（秒）",
                                type: "select" as const,
                                options: (video.duration.values || []).map((value) => ({ value: String(value), label: value === -1 ? "自动" : String(value) })),
                                recommended: String(video.duration.default),
                            }
                          : {
                                key: "videoSeconds",
                                label: "时长（秒）",
                                type: "number" as const,
                                min: video.duration.min,
                                max: video.duration.max,
                                step: video.duration.step || 1,
                                specialValues: video.duration.values?.filter((value) => value === -1).map((value) => ({ value, label: "自动" })),
                                recommended: String(video.duration.default),
                            },
                  ]),
            ...(video.generateAudio.supported ? [{ key: "videoGenerateAudio", label: "生成声音", type: "boolean" as const, recommended: String(video.generateAudio.default) }] : []),
            ...(video.watermark.supported ? [{ key: "videoWatermark", label: "添加水印", type: "boolean" as const, recommended: String(video.watermark.default) }] : []),
        ];
    }
    if (profile.capability === "image" && capability.image) {
        const image = capability.image;
        return [
            ...(image.size.parameter !== "none"
                ? [
                      {
                          key: "size",
                          label: "尺寸 / 比例",
                          type: image.size.allowCustom ? ("text" as const) : ("select" as const),
                          options: selectOptions(image.size.values),
                          recommended: image.size.default,
                      },
                  ]
                : []),
            ...(image.quality.supported && image.quality.values.length > 0 ? [{ key: "quality", label: "画质", type: "select" as const, options: selectOptions(image.quality.values), recommended: image.quality.default }] : []),
            {
                key: "count",
                label: "生成数量",
                type: "number",
                min: 1,
                max: Math.max(image.maxOutputs || 1, ...(image.generationOutputs || [])),
                step: 1,
                recommended: String(image.fixedOutputs || 1),
            },
            ...(image.transparentBackground.supported ? [{ key: "transparentBackground", label: "透明背景", type: "boolean" as const, recommended: String(image.transparentBackground.default) }] : []),
        ];
    }
    if (profile.capability === "audio") {
        const audio = audioSpeechProfile(profile.model);
        return [
            ...(audio.showVoice ? [{ key: "audioVoice", label: "音色", type: "select" as const, options: audio.voices, recommended: audio.defaultVoice }] : []),
            { key: "audioFormat", label: "音频格式", type: "select", options: audio.formats, recommended: audio.defaultFormat },
            ...(audio.showSpeed ? [{ key: "audioSpeed", label: "语速", type: "number" as const, min: audio.speedMin, max: audio.speedMax, step: 0.1, recommended: "1" }] : []),
            ...(audio.showPitch ? [{ key: "audioPitch", label: "音高", type: "number" as const, min: -12, max: 12, step: 1, recommended: "0" }] : []),
            ...(audio.showVolume ? [{ key: "audioVolume", label: "音量", type: "number" as const, min: 0, max: 1, step: 0.05, recommended: "1" }] : []),
            ...(audio.showInstructions ? [{ key: "audioInstructions", label: "声音描述", type: "text" as const }] : []),
        ];
    }
    return [];
}

function parameterContext(profile: ModelProfile, values: Record<string, unknown>, input: GenerationParameterInput): ProviderParameterContext {
    return { ...input, profile, values, generation: { ...profile.generationDefaults, ...input.generation } };
}

export function providerGenerationFields(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown> = {}, input: GenerationParameterInput = {}): GenerationParameterField[] {
    return providerGenerationDefinition(modelProviderDefinition(channel).id)?.parameters.fields(parameterContext(profile, values, input)) || [];
}

export function constrainedGenerationFields(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown> = {}, input: GenerationParameterInput = {}): GenerationParameterField[] {
    const provider = providerGenerationDefinition(modelProviderDefinition(channel).id)?.parameters;
    const common = commonGenerationFields(profile);
    const fields = provider?.constrainCommon?.(common, parameterContext(profile, values, input)) || common;
    for (const extension of providerGenerationFields(channel, profile, values, input)) {
        if (extension.hidden) continue;
        const raw = values[extension.key] ?? extension.recommended;
        if ((extension.read ? extension.read(raw) : raw) !== true) continue;
        for (const [key, value] of Object.entries(extension.forces || {})) {
            const field = fields.find((item) => item.key === key);
            if (field)
                Object.assign(field, {
                    forcedValue: value,
                    disabled: `由「${extension.label}」固定`,
                    ...(field.type === "select" ? { options: [{ value, label: value }] } : {}),
                });
        }
    }
    return fields;
}

export function parameterValidationError(fields: GenerationParameterField[], values: Record<string, unknown>, stringValues = false): string {
    for (const field of fields) {
        if (field.hidden) continue;
        const raw = field.forcedValue ?? values[field.key];
        if (raw === undefined) continue;
        if (raw === null || raw === "") return `${field.label}不能为空值`;
        if (field.disabled && field.forcedValue === undefined) return `${field.label}：${field.disabled}`;
        const custom = field.validate?.(raw);
        if (custom) return custom;
        const value = field.read ? field.read(raw) : raw;
        if (field.type === "boolean" && (stringValues ? !["true", "false"].includes(String(value)) : typeof value !== "boolean")) return `${field.label}需为开关值`;
        if (field.type === "number") {
            const numeric = Number(value);
            const special = field.specialValues?.some((item) => item.value === numeric);
            if (
                (!stringValues && typeof value !== "number") ||
                !Number.isFinite(numeric) ||
                (!special &&
                    ((field.min !== undefined && numeric < field.min) ||
                        (field.max !== undefined && numeric > field.max) ||
                        (field.step !== undefined && Math.abs((numeric - (field.min ?? 0)) / field.step - Math.round((numeric - (field.min ?? 0)) / field.step)) > 1e-7)))
            )
                return `${field.label}需为 ${field.min ?? "不限"}–${field.max ?? "不限"} 之间的数值${field.step ? `，步长 ${field.step}` : ""}${field.specialValues?.length ? `，或选择${field.specialValues.map((item) => item.label).join("、")}` : ""}`;
        }
        if (field.type === "text" && (typeof value !== "string" || (field.maxLength !== undefined && value.length > field.maxLength))) return `${field.label}需为${field.maxLength ? `不超过 ${field.maxLength} 字的` : ""}文本`;
        if (field.type === "select" && !field.options?.some((option) => option.value === String(value))) return `${field.label}不支持当前取值：${String(value)}`;
    }
    return "";
}

/** 只投影当前可编辑字段，再合入提供商的模式映射；配置中的额外键不能控制任务类型或泄漏到接口。 */
export function providerRequestParameters(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown>, input: GenerationParameterInput = {}): Record<string, unknown> {
    const definition = providerGenerationDefinition(modelProviderDefinition(channel).id)?.parameters;
    if (!definition) return {};
    const fields = providerGenerationFields(channel, profile, values, input);
    const active = fields.filter((field) => !field.hidden);
    const selected = Object.fromEntries(active.filter((field) => field.forcedValue !== undefined || values[field.key] !== undefined).map((field) => [field.key, field.forcedValue ?? values[field.key]]));
    const context = parameterContext(profile, selected, input);
    const error = parameterValidationError(active, selected) || definition.validate?.(context);
    if (error) throw new Error(error);
    const operation = definition.operations?.(context).find((mode) => mode.value === input.operation);
    return { ...selected, ...operation?.requestOptions };
}

export function validateProviderParameters(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown>, input: GenerationParameterInput = {}): void {
    providerRequestParameters(channel, profile, values, input);
}

/** 修改任一扩展字段后，以新状态重新计算显隐；UI 不包含服务商专属清理逻辑。 */
export function patchProviderParameter(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown>, key: string, value: unknown, input: GenerationParameterInput = {}) {
    const next = { ...values };
    if (value === undefined || value === null || value === "") delete next[key];
    else next[key] = value;
    return applicableProviderParameters(channel, profile, next, input);
}

export function applicableProviderParameters(channel: ModelChannel, profile: ModelProfile, values: Record<string, unknown>, input: GenerationParameterInput = {}) {
    const fields = providerGenerationFields(channel, profile, values, input);
    return Object.fromEntries(fields.filter((field) => !field.hidden && values[field.key] !== undefined).map((field) => [field.key, values[field.key]]));
}

export function configuredGenerationParameters(config: AiConfig, input: GenerationParameterInput = {}) {
    const channel = resolveModelChannel(config, config.model);
    const saved = channel.modelProfiles?.find((item) => item.model === modelOptionName(config.model));
    if (!saved) return undefined;
    const profile = { ...saved, capabilityConfig: modelCapabilityConfigFor(config, config.model) };
    const values = config.providerOptions?.[profile.protocol || ""] ?? profile.defaultOptions ?? {};
    const context = generationParameterInput(config, profile, input);
    return { channel, profile, values, input: context, common: constrainedGenerationFields(channel, profile, values, context), extensions: providerGenerationFields(channel, profile, values, context) };
}

/** 只提取当前模型的通用配置，不把凭证、连接对象等无关内容放进参数上下文。 */
export function generationParameterInput(config: AiConfig, profile: ModelProfile, input: GenerationParameterInput = {}): GenerationParameterInput {
    const generation = Object.fromEntries(
        commonGenerationFields(profile)
            .map((field) => [field.key, config[field.key as keyof AiConfig]])
            .filter(([, value]) => typeof value === "string"),
    ) as Record<string, string>;
    return { ...input, generation: { ...generation, ...input.generation } };
}

/** 将提供商约束应用到现有视频控件，保持原面板布局与交互。 */
export function videoGenerationSettings(config: AiConfig, input: GenerationParameterInput = {}) {
    const base = modelCapabilityConfigFor(config, config.model).video!;
    const parameters = configuredGenerationParameters(config, input);
    if (!parameters) return { config, profile: base, parameters };
    const field = (key: string) => parameters.common.find((item) => item.key === key && !item.hidden);
    const duration = field("videoSeconds");
    const durationProfile =
        duration?.forcedValue !== undefined
            ? { selection: "enum" as const, values: [Number(duration.forcedValue)], default: Number(duration.forcedValue) }
            : duration?.type === "number"
              ? { ...base.duration, min: duration.min, max: duration.max, step: duration.step, values: duration.specialValues?.map((item) => item.value) || base.duration.values }
              : duration?.type === "select"
                ? { ...base.duration, selection: "enum" as const, values: duration.options?.map((item) => Number(item.value)) || [] }
                : base.duration;
    const forced = Object.fromEntries(parameters.common.filter((item) => !item.hidden && item.forcedValue !== undefined).map((item) => [item.key, String(item.forcedValue)]));
    return {
        config: { ...config, ...forced },
        parameters,
        profile: {
            ...base,
            ratios: field("size")?.options?.map((item) => item.value) || [],
            resolutions: field("vquality")?.options?.map((item) => item.value) || [],
            durationSupported: Boolean(duration),
            duration: durationProfile,
            generateAudio: { ...base.generateAudio, supported: Boolean(field("videoGenerateAudio")) },
            watermark: { ...base.watermark, supported: Boolean(field("videoWatermark")) },
        },
    };
}

export function modelParameterError(channel: ModelChannel, profile: ModelProfile): string {
    const preset = providerPresetModelProfile(channel, profile.model);
    if (preset && profile.provider_model_family !== preset.provider_model_family) return "预置型号与模型系列不一致，请在接入设置中恢复预置接入";
    const contract = providerGenerationDefinition(modelProviderDefinition(channel).id);
    const effectiveProfile = contract?.capabilities ? { ...profile, capabilityConfig: modelCapabilityConfigFor({ channels: [channel] }, profile.model) } : profile;
    const error = parameterValidationError(constrainedGenerationFields(channel, effectiveProfile, profile.defaultOptions), profile.generationDefaults || {}, true);
    if (error) return error;
    try {
        validateProviderParameters(channel, profile, profile.defaultOptions || {});
    } catch (failure) {
        return failure instanceof Error ? failure.message : "模型参数无效";
    }
    return "";
}
