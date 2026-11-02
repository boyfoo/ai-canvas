import { generationParameterInput } from "@/lib/generation-parameters";
import { providerGenerationDefinition } from "@/lib/providers/generation-providers";
import { modelProviderDefinition } from "@/lib/model-service-presets";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ModelInputSummary } from "@/lib/model-selection";
import type { ProviderParameterContext } from "@/lib/generation-parameter-types";
import type { CanvasNodeMetadata, CanvasVideoEditOperation } from "@/types/canvas";
import { resolveVideoFrameIds } from "@/lib/video-frame-selection";

function operationContext(config: AiConfig, input: ModelInputSummary | undefined, operation?: string, model = config.model) {
    const channel = resolveModelChannel(config, model);
    const profile = channel.modelProfiles?.find((item) => item.model === modelOptionName(model));
    const contract = providerGenerationDefinition(modelProviderDefinition(channel).id)?.parameters;
    if (!profile || !contract?.operations) return undefined;
    const values = config.providerOptions?.[profile.protocol || ""] ?? profile.defaultOptions ?? {};
    const context: ProviderParameterContext = {
        ...generationParameterInput(config, profile, { operation }),
        profile,
        values,
        references: input ? { imageCount: input.imageCount + input.characterCount, videoCount: input.videoCount, audioCount: input.audioCount } : undefined,
    };
    return { context, contract };
}

export function providerVideoOperations(config: AiConfig, input?: ModelInputSummary, model = config.model) {
    const state = operationContext(config, input, undefined, model);
    return state?.contract.operations?.(state.context);
}

export function inferVideoOperation(input: ModelInputSummary) {
    const visualInputCount = input.imageCount + input.characterCount;
    if (input.videoCount > 0 || visualInputCount > 2) return "reference_to_video";
    if (visualInputCount > 0) return "image_to_video";
    if (input.audioCount > 0) return "audio_to_video";
    return "text_to_video";
}

/** 提供商已声明模式时保留显式意图，让缺素材和不支持的模式进入校验。 */
export function resolveVideoOperation(input: ModelInputSummary, storedOperation?: string, config?: AiConfig, model = config?.model) {
    const state = config ? operationContext(config, input, storedOperation, model) : undefined;
    if (state) return storedOperation || state.contract.defaultOperation?.(state.context) || "";
    if (storedOperation === "reference_to_video" && input.imageCount + input.characterCount + input.videoCount + input.audioCount > 0) return storedOperation;
    if (storedOperation === "extend" && input.videoCount > 0) return storedOperation;
    if (storedOperation && !["text_to_video", "image_to_video", "audio_to_video", "extend", "reference_to_video"].includes(storedOperation)) return storedOperation;
    return inferVideoOperation(input);
}

export function providerVideoOperationError(config: AiConfig, input: ModelInputSummary, operation?: string, model = config.model): string {
    const modes = providerVideoOperations(config, input, model);
    if (!modes) return "";
    const resolved = resolveVideoOperation(input, operation, config, model);
    const mode = modes.find((item) => item.value === resolved);
    return mode ? mode.inputIssue || "" : "当前模型不支持所选视频生成模式，请重新选择";
}

export function videoOperationMetadata(config: AiConfig, operation: string, imageNodeIds: string[] = []): Partial<CanvasNodeMetadata> {
    const mode = providerVideoOperations(config)?.find((item) => item.value === operation);
    const frames = mode?.referenceMode === "frames" ? resolveVideoFrameIds(imageNodeIds, undefined, mode.frameCount === 2) : undefined;
    return {
        videoEditOperation: operation as CanvasVideoEditOperation,
        videoStartFrameNodeId: frames?.first,
        videoEndFrameNodeId: frames?.last,
        videoMiddleFrameNodeId: undefined,
        videoMiddleFrameTime: undefined,
    };
}
