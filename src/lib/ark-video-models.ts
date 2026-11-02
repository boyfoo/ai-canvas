import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import type { ModelChannel } from "@/stores/use-config-store";
import { ARK_VIDEO_MODELS, ARK_VIDEO_PROTOCOL, arkVideoModelDefinition, applyArkVideoCapabilities } from "@/lib/providers/ark-video-capabilities";

export { ARK_VIDEO_MODELS, ARK_VIDEO_PROTOCOL, arkVideoModelDefinition } from "@/lib/providers/ark-video-capabilities";

export function arkVideoModelProfile(model: string, family?: string): NonNullable<ModelChannel["modelProfiles"]>[number] {
    const definition = arkVideoModelDefinition(model, family);
    const capabilityConfig = applyArkVideoCapabilities(defaultModelCapabilityConfig(ARK_VIDEO_PROTOCOL, definition.id), model, definition.family);
    return { model, displayName: definition.id === model ? definition.name : undefined, provider_model_family: definition.family, capability: "video", protocol: ARK_VIDEO_PROTOCOL, capabilityConfig };
}

export function arkVideoModelCatalog(): ChannelModelCatalogItem[] {
    return ARK_VIDEO_MODELS.map(item => ({ id: item.id, displayName: item.name, modelType: "video", supportedEndpointTypes: [ARK_VIDEO_PROTOCOL] }));
}
