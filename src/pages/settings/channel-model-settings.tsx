import { useEffect, useState } from "react";
import { Alert, App, Button, Collapse, Descriptions, Popconfirm, Select, Tabs, Tag } from "antd";
import { ChevronRight, FlaskConical, Trash2 } from "lucide-react";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { GenerationParameterFields } from "@/components/generation-parameter-fields";
import { GenerationParameterSection } from "@/components/generation-parameter-section";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { SeedreamSettings } from "@/components/seedream-settings";
import { seedreamFamily } from "@/lib/seedream-image";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { testChannelModelConnection } from "@/lib/model-connection-test";
import { defaultModelCapabilityConfig, videoDurationRequirement } from "@/lib/model-capabilities";
import { providerVideoOperations } from "@/lib/generation-operations";
import {
    constrainedGenerationFields,
    applicableProviderParameters,
    modelParameterError,
    providerGenerationFields,
    type GenerationDefaults,
    type ModelProfile,
} from "@/lib/generation-parameters";
import { CAPABILITY_LABELS, modelProviderDefinition, providerPresetModelProfile, serviceModelProfile } from "@/lib/model-service-presets";
import { modelProtocolDefinition, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { signatureCredentialHint } from "@/lib/service-credentials";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { defaultConfig, encodeChannelModel, isBuiltinBeefAPIChannel, modelOptionName, type ModelChannel } from "@/stores/use-config-store";
import { currentModelConnectionReceipt, useModelConnectionTests } from "@/stores/use-model-connection-tests";

export function ChannelModelSettings({
    channel,
    onChange,
    onRemove,
}: {
    channel: ModelChannel;
    onChange: (update: (profiles: ModelProfile[]) => ModelProfile[]) => void;
    onRemove?: (model: string) => void;
}) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const [testingModel, setTestingModel] = useState("");
    const [activeModel, setActiveModel] = useState("");
    const [tab, setTab] = useState("capabilities");
    const [protocols, setProtocols] = useState<ModelProtocolDefinition[]>([]);
    const [protocolError, setProtocolError] = useState("");
    const { receipts, record } = useModelConnectionTests();
    useEffect(() => {
        let active = true;
        void fetchPluginProviderCatalog("user.custom-channel")
            .then((items) => {
                if (active) setProtocols(items);
            })
            .catch((error) => {
                if (active) setProtocolError(error instanceof Error ? error.message : "协议目录读取失败");
            });
        return () => {
            active = false;
        };
    }, []);
    if (!channel.models.length)
        return <p className="rounded-lg bg-surface-active p-5 text-center text-xs text-foreground/50">还没有启用模型，请选择目录中的模型或手动添加。</p>;
    const provider = modelProviderDefinition(channel);
    const selected = channel.models.includes(activeModel) ? activeModel : channel.models[0];
    const profile = serviceModelProfile(channel, { id: selected }, protocols);
    const presetProfile = providerPresetModelProfile(channel, selected);
    const receipt = currentModelConnectionReceipt(receipts, channel, selected);
    const capability = profile.capabilityConfig || defaultModelCapabilityConfig(profile.protocol, selected);
    const seedream = profile.capability === "image" ? seedreamFamily(selected) : "";
    const fields = constrainedGenerationFields(channel, profile, profile.defaultOptions);
    const extraFields = providerGenerationFields(channel, profile, profile.defaultOptions);
    const readOnly = channel.scope === "system";
    const managed =
        readOnly || isBuiltinBeefAPIChannel(channel) || Boolean(profile.logicalModelId || profile.videoCapabilitiesVersion || profile.imageCapabilitiesVersion);
    const defaultPreview = {
        ...defaultConfig,
        ...Object.fromEntries(fields.filter((field) => field.recommended !== undefined).map((field) => [field.key, String(field.recommended)])),
        ...profile.generationDefaults,
        channels: [{ ...channel, models: [selected], modelProfiles: [profile] }],
        model: encodeChannelModel(channel.id, selected),
    };
    const update = (patch: Partial<ModelProfile> | ((profile: ModelProfile) => Partial<ModelProfile>)) => {
        onChange((profiles) => {
            const current = profiles.find((item) => item.model === selected) || profile;
            const changes = typeof patch === "function" ? patch(current) : patch;
            const next = { ...current, ...changes };
            if ("protocol" in changes) next.authType = modelProtocolDefinition(next.protocol, protocols)?.authType;
            return [...profiles.filter((item) => item.model !== selected), next];
        });
    };
    const runTest = async () => {
        const error = modelParameterError(channel, profile);
        if (error) {
            message.error(error);
            return;
        }
        setTestingModel(selected);
        try {
            const detail = await testChannelModelConnection(channel, selected, profile.capability, profile.protocol!);
            record(channel, selected, { success: true, detail });
            message.success(detail);
        } catch (failure) {
            const detail = failure instanceof Error ? failure.message : "生成验证失败";
            record(channel, selected, { success: false, detail });
            message.error(detail);
        } finally {
            setTestingModel("");
        }
    };
    const references = capability.video?.references || capability.image?.references || capability.text?.references;
    const operations = profile.capability === "video" ? providerVideoOperations(defaultPreview) : undefined;
    const details = [
        { key: "id", label: "调用 ID", children: <span className="break-all font-mono text-xs">{selected}</span> },
        { key: "kind", label: "模型类型", children: CAPABILITY_LABELS[profile.capability] },
        ...(operations?.length ? [{ key: "operations", label: "支持模式", children: <div className="flex flex-wrap gap-1.5">{operations.map(mode => <Tag key={mode.value} className="!m-0" title={mode.help}>{mode.label}</Tag>)}</div> }] : []),
        ...(profile.provider_model_family
            ? [
                  {
                      key: "family",
                      label: "模型系列",
                      children: provider.families?.find((item) => item.value === profile.provider_model_family)?.label || profile.provider_model_family,
                  },
              ]
            : []),
        ...(capability.video
            ? [
                  { key: "ratios", label: "支持比例", children: capability.video.ratios.join("、") || "由服务决定" },
                  { key: "resolutions", label: "支持分辨率", children: capability.video.resolutions.join("、") || "由服务决定" },
                  {
                      key: "duration",
                      label: "支持时长",
                      children: videoDurationRequirement(capability.video.duration),
                  },
                  { key: "images", label: "最多参考图片", children: String(capability.video.references.maxImages) },
                  { key: "videos", label: "最多参考视频", children: String(capability.video.references.maxVideos) },
                  { key: "audios", label: "最多参考音频", children: String(capability.video.references.maxAudios) },
              ]
            : []),
        ...(capability.image
            ? [
                  { key: "sizes", label: "支持尺寸 / 比例", children: capability.image.size.values.join("、") || "由服务决定" },
                  { key: "images", label: "最多参考图片", children: String(capability.image.references.maxImages) },
                  { key: "outputs", label: "单次最多输出", children: String(capability.image.maxOutputs) },
              ]
            : []),
        ...(capability.text
            ? [
                  { key: "stream", label: "流式响应", children: capability.text.streaming ? "支持" : "未声明" },
                  { key: "thinking", label: "思考模式", children: capability.text.thinking ? "支持" : "未声明" },
              ]
            : []),
        ...(references?.promptMaxChars ? [{ key: "prompt", label: "提示词长度上限", children: `${references.promptMaxChars} 字符` }] : []),
    ];
    return (
        <div className="space-y-4">
            <div className="space-y-1.5" aria-label="已启用模型">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const item = serviceModelProfile(channel, { id: model }, protocols);
                    const result = currentModelConnectionReceipt(receipts, channel, model);
                    return (
                        <div key={model} className={`model-connection-model ${model === selected ? "is-selected" : ""}`}>
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                disabled={Boolean(testingModel)}
                                aria-pressed={model === selected}
                                onClick={() => {
                                    setActiveModel(model);
                                    setTab("capabilities");
                                }}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-medium">{item.displayName || model}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <Tag className="!m-0">{CAPABILITY_LABELS[item.capability]}</Tag>
                                        <span className="text-xs text-foreground/45">
                                            {!item.protocol ? "待配置协议" : result ? (result.success ? "生成验证通过" : "生成验证失败") : "未生成验证"}
                                        </span>
                                    </div>
                                </div>
                                <ChevronRight size={14} />
                            </button>
                            {onRemove && !managed && (
                                <Button
                                    type="text"
                                    size="small"
                                    disabled={Boolean(testingModel)}
                                    aria-label={`停用模型 ${model}`}
                                    icon={<Trash2 size={13} />}
                                    onClick={() => onRemove(rawModel)}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <section className="rounded-lg border border-[var(--workspace-border)] p-4" aria-label={`模型详情 ${selected}`}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="break-all text-sm font-semibold">{profile.displayName || selected}</h4>
                        <p className="mt-1 text-xs text-foreground/45">能力定义决定可用选项，默认参数用于新建生成节点。</p>
                    </div>
                    <Popconfirm
                        title="提交一次真实生成？"
                        description="费用由服务商收取；完成后可在任务中心查看结果。"
                        okText="开始生成"
                        cancelText="取消"
                        onConfirm={() => void runTest()}
                    >
                        <Button
                            size="small"
                            icon={<FlaskConical size={13} />}
                            loading={Boolean(testingModel)}
                            disabled={!profile.protocol || Boolean(protocolError)}
                        >
                            生成验证
                        </Button>
                    </Popconfirm>
                </div>
                {receipt && <Alert className="mb-3" type={receipt.success ? "success" : "error"} title={receipt.detail} showIcon />}
                {protocolError && <Alert className="mb-3" type="error" title={protocolError} showIcon />}
                <div inert={Boolean(testingModel)}>
                    <Tabs
                        activeKey={tab}
                        onChange={setTab}
                        animated={false}
                        items={[
                            { key: "capabilities", label: "能力说明", children: <Descriptions size="small" column={1} items={details} /> },
                            {
                                key: "defaults",
                                label: "参数默认值",
                                children: (
                                    <div className="space-y-5">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs leading-5 text-foreground/50">此模型中新建节点的初始参数；已有节点保留自己的设置。默认使用哪个模型在「默认模型」页选择。</p>
                                            <Button size="small" disabled={readOnly} onClick={() => update({ generationDefaults: {}, defaultOptions: {} })}>
                                                恢复推荐值
                                            </Button>
                                        </div>
                                        {profile.capability === "image" ? (
                                            <>
                                            <GenerationParameterSection kind="common">
                                            <div inert={readOnly}>
                                                <ImageSettingsPanel
                                                    config={defaultPreview}
                                                    theme={theme}
                                                    showTitle={false}
                                                    showSeedreamOptions={false}
                                                    className="space-y-4"
                                                    onConfigChange={(key, value) =>
                                                        update((current) => ({ generationDefaults: { ...current.generationDefaults, [key]: value } }))
                                                    }
                                                />
                                            </div>
                                            </GenerationParameterSection>
                                            {seedream && capability.image && <GenerationParameterSection kind="extension" source="Seedream"><div inert={readOnly}><SeedreamSettings config={defaultPreview} family={seedream} profile={capability.image} theme={theme} showSize={false} onChange={(key, value) => update(current => ({ generationDefaults: { ...current.generationDefaults, [key]: value } }))} /></div></GenerationParameterSection>}
                                            </>
                                        ) : profile.capability === "audio" ? (
                                            <GenerationParameterSection kind="common">
                                            <div inert={readOnly}>
                                                <AudioSettingsPanel
                                                    config={defaultPreview}
                                                    theme={theme}
                                                    showTitle={false}
                                                    className="space-y-4"
                                                    onConfigChange={(key, value) =>
                                                        update((current) => ({ generationDefaults: { ...current.generationDefaults, [key]: value } }))
                                                    }
                                                />
                                            </div>
                                            </GenerationParameterSection>
                                        ) : fields.length ? (
                                            <GenerationParameterSection kind="common"><GenerationParameterFields
                                                fields={fields}
                                                value={profile.generationDefaults || {}}
                                                stringValues
                                                disabled={readOnly}
                                                onChange={(generationDefaults) => update({ generationDefaults: generationDefaults as GenerationDefaults })}
                                            /></GenerationParameterSection>
                                        ) : (
                                            <GenerationParameterSection kind="common"><p className="text-xs text-foreground/50">当前模型没有声明可配置的通用生成参数。</p></GenerationParameterSection>
                                        )}
                                        {extraFields.length > 0 && (
                                            <GenerationParameterSection kind="extension" source={provider.name}>
                                                <GenerationParameterFields
                                                    fields={extraFields}
                                                    value={profile.defaultOptions || {}}
                                                    disabled={readOnly}
                                                    onChange={(defaultOptions) => update(current => ({ defaultOptions: applicableProviderParameters(channel, current, defaultOptions) }))}
                                                />
                                            </GenerationParameterSection>
                                        )}
                                    </div>
                                ),
                            },
                            {
                                key: "access",
                                label: "接入设置",
                                children: (
                                    <div className="space-y-4">
                                        <p className="text-xs text-foreground/55">
                                            请求协议：{modelProtocolDefinition(profile.protocol, protocols)?.label || profile.protocol || "待配置"}
                                        </p>
                                        {provider.families && !managed && (
                                            <div className="space-y-2">
                                                <label className="text-xs" htmlFor="model-provider-family">
                                                    模型系列 <Tag color="purple" className="!m-0">扩展 · {provider.name}</Tag>
                                                </label>
                                                {presetProfile ? <p className="text-sm" aria-label="模型系列">{provider.families.find(item => item.value === presetProfile.provider_model_family)?.label}<Tag className="ml-2">已固定</Tag></p> : <Select
                                                    id="model-provider-family"
                                                    aria-label="模型系列"
                                                    className="w-full"
                                                    value={profile.provider_model_family}
                                                    options={provider.families}
                                                    onChange={(family) =>
                                                        update({
                                                            ...provider.createProfile!(profile.model, family),
                                                            generationDefaults: {},
                                                            defaultOptions: {},
                                                        })
                                                    }
                                                />}
                                                {!presetProfile && <p className="text-xs text-foreground/45">自定义 Model ID / Endpoint ID 需选择实际模型系列；更改系列会重设能力和默认值。</p>}
                                                {presetProfile && profile.provider_model_family !== presetProfile.provider_model_family && <Alert type="error" showIcon title="预置型号与模型系列不一致" action={<Button size="small" onClick={() => update({ ...presetProfile, generationDefaults: {}, defaultOptions: {} })}>恢复预置接入</Button>} />}
                                            </div>
                                        )}
                                        {!provider.fixedProtocol && !managed && (
                                            <Collapse
                                                ghost
                                                defaultActiveKey={!profile.protocol ? ["protocol"] : []}
                                                items={[
                                                    {
                                                        key: "protocol",
                                                        label: "自定义调用协议",
                                                        children: (
                                                            <div className="space-y-3">
                                                                <Select
                                                                    aria-label="模型类型"
                                                                    className="w-full"
                                                                    value={profile.capability}
                                                                    options={Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }))}
                                                                    onChange={(capability) =>
                                                                        update({
                                                                            capability,
                                                                            protocol: undefined,
                                                                            capabilityConfig: undefined,
                                                                            generationDefaults: {},
                                                                            defaultOptions: {},
                                                                        })
                                                                    }
                                                                />
                                                                <ModelProtocolBrowser
                                                                    value={profile.protocol || ""}
                                                                    protocols={protocols}
                                                                    capability={profile.capability}
                                                                    onChange={(protocol) =>
                                                                        update({
                                                                            protocol,
                                                                            capabilityConfig: defaultModelCapabilityConfig(protocol, profile.model),
                                                                            generationDefaults: {},
                                                                            defaultOptions: {},
                                                                        })
                                                                    }
                                                                />
                                                                <p className="text-xs text-foreground/50">
                                                                    {signatureCredentialHint(modelProtocolDefinition(profile.protocol, protocols)?.authType)}
                                                                </p>
                                                            </div>
                                                        ),
                                                    },
                                                ]}
                                            />
                                        )}
                                        {provider.id === "compatible" && !managed && profile.capability !== "audio" && (
                                            <Collapse
                                                ghost
                                                items={[
                                                    {
                                                        key: "capability",
                                                        label: "自定义模型能力",
                                                        children: (
                                                            <>
                                                                <p className="mb-3 text-xs leading-5 text-foreground/50">
                                                                    这里声明上游实际支持的范围，不会改变服务商自身能力；每次生成参数在画布中调整。
                                                                </p>
                                                                <ModelCapabilityEditor
                                                                    capability={profile.capability}
                                                                    model={profile.model}
                                                                    value={capability}
                                                                    protocol={profile.protocol}
                                                                    onChange={(capabilityConfig) => update({ capabilityConfig, generationDefaults: {} })}
                                                                />
                                                            </>
                                                        ),
                                                    },
                                                ]}
                                            />
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </section>
        </div>
    );
}
