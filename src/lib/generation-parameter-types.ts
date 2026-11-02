import type { ModelChannel } from "@/stores/use-config-store";

/** 输入来自当前节点；省略 operation/references 表示正在编辑模型默认值。 */
export type GenerationParameterInput = {
    generation?: Record<string, string | undefined>;
    operation?: string;
    references?: { imageCount: number; videoCount: number; audioCount: number; videoDurationsMs?: number[] };
};

export type ProviderParameterContext = GenerationParameterInput & {
    profile: NonNullable<ModelChannel["modelProfiles"]>[number];
    values: Record<string, unknown>;
};

/**
 * 提供商参数契约：只声明当前执行通道确实已接入的字段。
 * fields 作为设置页、画布、可编辑请求参数白名单及校验的数据源，禁止在 UI 里判断提供商 ID。
 * 由模式派生的内部请求字段放在 operations.requestOptions，不再重复暴露成用户配置。
 * 字段 key 使用服务商原始 snake_case；通用字段仍使用应用内的配置键。
 */
export interface ProviderGenerationParameters {
    /** 模式也是提供商能力：名称、素材要求、请求映射和参数固定值共用一份定义。 */
    operations?: (context: ProviderParameterContext) => GenerationOperationDefinition[];
    /** 未选择时使用模型固定的默认模式，不按素材数量自动切换；显式选择始终保留。 */
    defaultOperation?: (context: ProviderParameterContext) => string;
    fields: (context: ProviderParameterContext) => GenerationParameterField[];
    constrainCommon?: (fields: GenerationParameterField[], context: ProviderParameterContext) => GenerationParameterField[];
    validate?: (context: ProviderParameterContext) => string | undefined;
}

export type GenerationOperationDefinition = {
    value: string;
    label: string;
    help?: string;
    /** 当前素材未就绪的原因；允许先选模式再补素材，提交前必须通过此项检查。 */
    inputIssue?: string;
    referenceMode: "none" | "frames" | "all";
    frameCount?: 1 | 2;
    /** 协议通过提示词表达模式时附加任务指令，保留用户原提示词。 */
    promptPrefix?: string;
    /** 本模式对应的内部请求映射，由提供商投影；不再作为可编辑字段让用户重复选择。 */
    requestOptions?: Record<string, string | number | boolean>;
    /** 当前模式固定的通用参数，画布展示和实际请求必须一致。 */
    forces?: Record<string, string>;
};

export type GenerationParameterField = {
    key: string;
    label: string;
    type: "select" | "number" | "boolean" | "text";
    options?: Array<{ value: string; label: string }>;
    min?: number;
    max?: number;
    step?: number;
    /** 数值范围之外的合法特殊值，例如时长 -1（自动）。 */
    specialValues?: Array<{ value: number; label: string }>;
    maxLength?: number;
    recommended?: unknown;
    help?: string;
    disabled?: string;
    /** 当前任务中不适用：不展示、不校验旧值、也不发送。模型根本不支持的字段则不要声明。 */
    hidden?: boolean;
    forces?: Record<string, string>;
    forcedValue?: string | number | boolean;
    read?: (value: unknown) => string | number | boolean | undefined;
    write?: (value: string | number | boolean | undefined) => unknown;
    validate?: (value: unknown) => string | undefined;
    /** 可选的画布摘要，例如以帧数替代秒数；UI 无需认识具体参数键。 */
    summary?: (value: unknown) => string;
};
