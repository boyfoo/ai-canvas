import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
import type { WorkspaceCapabilityContract } from "@/services/workspace-mode";
import type { AiConfig } from "@/stores/use-config-store";
import type { FeatureAvailability, LocalUser, RuntimeLimits } from "@/stores/use-user-store";

export type ModelCapabilityDraftInput = {
    capability?: string;
    category?: string;
    type?: string;
    protocol?: ModelProtocol | string;
    interfaceType?: ModelProtocol | string;
    model: string;
    baseUrl?: string;
    channelId?: string;
    videoCapabilitiesVersion?: string;
    capabilityConfig?: ModelCapabilityConfig;
};

export async function normalizeModelCapabilityDraft(draft: ModelCapabilityDraftInput): Promise<ModelCapabilityConfig & { capabilityConfig?: ModelCapabilityConfig }> {
    return normalizeModelCapabilityConfig(draft.capabilityConfig || defaultModelCapabilityConfig(draft.protocol || draft.interfaceType, draft.model));
}

export type LocalWorkspace = {
    id: string;
    name: string;
    owner: "local";
    storage: "indexeddb";
};

export type WorkspaceBootstrapPayload = {
    contractVersion: number;
    profile: "local";
    capabilities: WorkspaceCapabilityContract["capabilities"];
    user: LocalUser;
    workspace: LocalWorkspace;
    storageMode: "local";
    runtimeLimits?: RuntimeLimits;
    features?: FeatureAvailability;
};

export type LocalModelConfigPayload = {
	config: AiConfig;
	revision: number;
	health: "ready" | "default";
	source: "browser";
};

