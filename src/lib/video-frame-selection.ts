import type { CanvasNodeMetadata } from "@/types/canvas";

/** 轻量帧顺序规则，由图片位和请求适配共用，不依赖画布连线、素材库或组件。 */
export function resolveVideoFrameIds(imageIds: string[], metadata?: Pick<CanvasNodeMetadata, "videoStartFrameNodeId" | "videoEndFrameNodeId">, endFrameSupported = true) {
    const specifiedLast = endFrameSupported ? metadata?.videoEndFrameNodeId : undefined;
    const first = metadata?.videoStartFrameNodeId || imageIds.find((id) => id !== specifiedLast);
    const last = endFrameSupported ? specifiedLast || imageIds.find((id) => id !== first) : undefined;
    return { first, last };
}
