import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ProviderGenerationParameters } from "@/lib/generation-parameter-types";
import { ARK_VIDEO_MODELS, applyArkVideoCapabilities } from "./ark-video-capabilities";
import { arkVideoGenerationParameters } from "./ark-video-parameters";

export interface ProviderGenerationDefinition {
    parameters: ProviderGenerationParameters;
    /** 官方模型能力的权威来源。只在实现了相应生成通道的提供商上注册。 */
    capabilities?: (base: ModelCapabilityConfig, model: string, family?: string) => ModelCapabilityConfig;
}

// 新提供商在这里注册生成契约，在 model-service-presets.ts 注册连接信息。
// 不注册即沿用其原执行协议和模型能力，不因域名或相同模型名字套用别家的扩展。
const GENERATION_PROVIDERS: Record<string, ProviderGenerationDefinition> = {
    "ark-video": {
        parameters: arkVideoGenerationParameters,
        capabilities: (base, model, family) => applyArkVideoCapabilities(base, model, ARK_VIDEO_MODELS.find((item) => item.id === model)?.family || family),
    },
};

export function providerGenerationDefinition(providerId: string | undefined): ProviderGenerationDefinition | undefined {
    return providerId ? GENERATION_PROVIDERS[providerId] : undefined;
}
