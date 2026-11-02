import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Collapse, Form, Input, Select, Spin, Switch, Tabs, Tag } from "antd";
import { Check, KeyRound, Search } from "lucide-react";
import { ModelLogo } from "@/components/model-logo";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { fetchChannelModels, type ChannelModelFetchResult } from "@/services/api/image-models";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { mergeFetchedChannelModelProfiles, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import {
    CAPABILITY_LABELS,
    MODEL_SERVICE_PRESETS,
    isTopazUpscaleChannel,
    modelCatalogRequestURL,
    modelProviderDefinition,
    channelReferenceMediaKinds,
    channelSupportsReferenceAssetOrigin,
    channelSupportsPrivateAssetSync,
    serviceConnectionError,
    serviceModelProfile,
    servicePresetFor,
    type ModelServicePresetId,
} from "@/lib/model-service-presets";
import { modelParameterError } from "@/lib/generation-parameters";
import { serviceCredentialGuide } from "@/lib/service-credentials";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { seedancePortraitLabel } from "@/lib/seedance-portrait";
import { buildApiUrl, createModelChannel, isBuiltinBeefAPIChannel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-model-settings";
import { ReferenceMediaTransportFields } from "./reference-media-transport-fields";
import { getTransportFailureKind } from "@/services/api/request";
import { ModelDirectTestModal } from "./model-direct-test-modal";
import "./model-service-editor.css";

type Props = { initial?: ModelChannel; onClose: () => void; onSave: (channel: ModelChannel) => Promise<void>; onDirtyChange?: (dirty: boolean) => void };

export function ModelServiceEditor({ initial, onClose, onSave, onDirtyChange }: Props) {
    const [draft, setDraft] = useState<ModelChannel>(() =>
        initial ? structuredClone(initial) : { ...createModelChannel({ provider_id: "compatible" }), name: "", baseUrl: "" },
    );
    const [tab, setTab] = useState(initial && !initial.models.length ? "models" : "connection");
    const [catalog, setCatalog] = useState<ChannelModelCatalogItem[]>(() => (initial?.models || []).map((id) => ({ id })));
    const [catalogOpen, setCatalogOpen] = useState(false);
    const [catalogState, setCatalogState] = useState<"idle" | "success" | "error">("idle");
    const [protocols, setProtocols] = useState<ModelProtocolDefinition[]>([]);
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [directTestOpen, setDirectTestOpen] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [manualName, setManualName] = useState("");
    const [manualCapability, setManualCapability] = useState<ModelCapability>();
    const [manualFamily, setManualFamily] = useState<string>();
    const requestRef = useRef<AbortController | null>(null);
    const alive = useRef(true);
    const provider = modelProviderDefinition(draft);
    const credential = serviceCredentialGuide(draft, protocols);
    const presetCatalog = provider.catalogSource === "preset";
    const managed = isBuiltinBeefAPIChannel(draft) || draft.scope === "system";
    const topaz = isTopazUpscaleChannel(draft);
    const referenceKinds = channelReferenceMediaKinds(draft);

    useEffect(() => {
        alive.current = true;
        void fetchPluginProviderCatalog("user.custom-channel")
            .then((items) => {
                if (alive.current) setProtocols(items);
            })
            .catch(() => {
                if (alive.current) setError("无法读取请求协议，请重新打开连接");
            })
            .finally(() => {
                if (alive.current) setProtocolLoading(false);
            });
        return () => {
            alive.current = false;
            requestRef.current?.abort();
        };
    }, []);
    useEffect(() => {
        onDirtyChange?.(dirty || saving);
    }, [dirty, saving, onDirtyChange]);
    useEffect(() => {
        if (!dirty) return;
        const preventLoss = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", preventLoss);
        return () => window.removeEventListener("beforeunload", preventLoss);
    }, [dirty]);

    const patch = (value: Partial<ModelChannel>) => {
        setDraft((current) => ({ ...current, ...value }));
        setDirty(true);
        setError("");
    };
    const chooseProvider = (id: ModelServicePresetId) => {
        const definition = MODEL_SERVICE_PRESETS.find((item) => item.id === id)!;
        requestRef.current?.abort();
        setDraft({
            ...createModelChannel({ id: draft.id, provider_id: id, apiFormat: definition.apiFormat }),
            name: definition.name,
            baseUrl: definition.baseUrl,
        });
        setCatalog([]);
        setManualFamily(undefined);
        setCatalogState("idle");
        setCatalogOpen(false);
        setError("");
        setNotice("");
        setDirty(true);
    };
    const validateConnection = (requireCredential = true, channel = draft) => {
        const problem = managed ? "" : serviceConnectionError(channel, { protocols, requireCredential }) || validateChannelHeaders(channel.headers);
        if (problem) {
            setError(problem);
            setTab("connection");
        }
        return !problem;
    };
    const applyCatalog = (result: ChannelModelFetchResult) => {
        const byId = new Map(catalog.map((item) => [item.id, item]));
        for (const item of result.catalog) byId.set(item.id, item);
        for (const id of result.models) if (!byId.has(id)) byId.set(id, { id });
        const next = [...byId.values()];
        const enriched = mergeFetchedChannelModelProfiles({ ...draft, modelProfiles: [] }, result.catalog);
        const existing = new Set(draft.modelProfiles?.map((item) => item.model));
        const profiles = next.map((item) => {
            const profile = serviceModelProfile(draft, item, protocols);
            const metadata = enriched.find((candidate) => candidate.model === profile.model);
            return presetCatalog || existing.has(profile.model) || !metadata?.capabilityConfig
                ? profile
                : { ...profile, capabilityConfig: metadata.capabilityConfig };
        });
        patch({ modelProfiles: profiles });
        setCatalog(next);
        setCatalogState("success");
        setCatalogOpen(true);
        setTab("models");
        setNotice(presetCatalog ? "预置模型不代表账号已开通；请选择需要使用的模型。" : `已读取 ${result.models.length} 个模型。目录读取与生成验证分别记录。`);
    };
    const fetchModels = async () => {
        if ((!presetCatalog && !validateConnection()) || topaz) return;
        requestRef.current?.abort();
        const request = new AbortController();
        requestRef.current = request;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const result = await fetchChannelModels(draft, request.signal);
            if (alive.current && !request.signal.aborted) applyCatalog(result);
        } catch (failure) {
            if (alive.current && !request.signal.aborted) {
                setCatalogState("error");
                const kind = getTransportFailureKind(failure);
                setError(
                    kind === "timeout"
                        ? "模型目录读取超时"
                        : kind === "network"
                          ? "模型目录请求失败，可能是网络连接或该接口的跨域限制"
                          : failure instanceof Error
                            ? failure.message
                            : "模型目录读取失败",
                );
                setNotice("可以手动添加模型。目录读取失败不能说明生成接口是否可用。");
            }
        } finally {
            if (alive.current && requestRef.current === request) setBusy(false);
        }
    };
    const toggleModel = (id: string, enabled: boolean) => {
        const profile = serviceModelProfile(draft, catalog.find((item) => item.id === id) || { id }, protocols);
        patch({
            models: enabled ? [...new Set([...draft.models, id])] : draft.models.filter((model) => model !== id),
            modelProfiles: [...(draft.modelProfiles || []).filter((item) => item.model !== id), profile],
        });
    };
    const addManual = () => {
        const id = manualName.trim();
        if (!id) return;
        if (draft.models.includes(id)) {
            setError("这个模型已启用");
            return;
        }
        if (provider.families && !manualFamily) {
            setError("请选择模型系列");
            return;
        }
        if (!provider.createProfile && !manualCapability) {
            setError("请选择模型类型");
            return;
        }
        let profile: ReturnType<typeof serviceModelProfile>;
        try {
            profile = provider.createProfile ? provider.createProfile(id, manualFamily) : serviceModelProfile(draft, { id }, protocols, manualCapability);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "模型系列与调用 ID 不一致");
            return;
        }
        setCatalog((current) => (current.some((item) => item.id === id) ? current : [...current, { id, modelType: profile.capability }]));
        patch({ models: [...draft.models, id], modelProfiles: [...(draft.modelProfiles || []).filter((item) => item.model !== id), profile] });
        setManualName("");
        setManualCapability(undefined);
        setManualFamily(undefined);
        if (!profile.protocol) setNotice("请在模型详情的接入设置中选择请求协议。");
    };
    const save = async () => {
        if (!validateConnection()) return;
        if (!draft.models.length) {
            setError("请至少启用一个模型");
            setTab("models");
            return;
        }
        const profiles = topaz
            ? draft.modelProfiles || []
            : draft.models.map((id) => serviceModelProfile(draft, catalog.find((item) => item.id === id) || { id }, protocols));
        const invalid = profiles.find(
            (profile) => !profile.protocol || (provider.fixedProtocol && profile.protocol !== provider.fixedProtocol) || modelParameterError(draft, profile),
        );
        if (invalid) {
            setError(
                `${invalid.displayName || invalid.model}：${!invalid.protocol ? "请选择请求协议" : modelParameterError(draft, invalid) || "请求协议不适用于此提供商"}`,
            );
            setTab("models");
            return;
        }
        const next = {
            ...draft,
            provider_id: servicePresetFor(draft),
            modelProfiles: [...profiles, ...(draft.modelProfiles || []).filter((profile) => !draft.models.includes(profile.model))],
        };
        if (!validateConnection(true, next)) return;
        setSaving(true);
        setError("");
        try {
            await onSave({
                ...next,
                name: draft.name.trim() || provider.name,
                baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
                apiKey: draft.apiKey.trim(),
                secretKey: draft.secretKey?.trim(),
            });
            if (alive.current) {
                setDirty(false);
                setNotice("连接和模型配置已保存。");
            }
        } catch (failure) {
            if (alive.current) setError(failure instanceof Error ? failure.message : "保存失败");
        } finally {
            if (alive.current) setSaving(false);
        }
    };
    const visibleModels = catalog.filter((item) => `${item.id} ${item.displayName || ""}`.toLowerCase().includes(query.toLowerCase()));

    return (
        <section className="model-service-editor" aria-label={initial ? `编辑连接 ${initial.name}` : "添加连接"}>
            <div className="model-service-header">
                <div className="flex items-center gap-3">
                    <ModelLogo icon={provider.icon} size={26} />
                    <div>
                        <h2>{initial ? draft.name || "编辑连接" : "添加连接"}</h2>
                        <p className="mt-1 text-xs text-foreground/50">
                            {provider.name}
                            {dirty ? " · 有未保存更改" : ""}
                        </p>
                    </div>
                </div>
            </div>
            <div className="model-service-body" inert={saving}>
                <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    animated={false}
                    items={[
                        {
                            key: "connection",
                            label: "连接信息",
                            children: (
                                <Form component="div" layout="vertical" requiredMark={false} className="model-service-fields" disabled={busy || saving}>
                                    {!topaz && (
                                        <Form.Item label="提供商" tooltip="决定连接使用的接入规则、模型目录和扩展功能。不同账号可以分别添加连接。">
                                            <Select
                                                aria-label="提供商"
                                                value={servicePresetFor(draft)}
                                                disabled={Boolean(initial)}
                                                options={MODEL_SERVICE_PRESETS.map((item) => ({ value: item.id, label: item.name }))}
                                                onChange={chooseProvider}
                                            />
                                        </Form.Item>
                                    )}
                                    <Form.Item label="连接名称" tooltip="用于区分你的账号或服务，不会作为模型 ID 发送给服务商。">
                                        <Input
                                            id={`channel-${draft.id}-name`}
                                            aria-label="连接名称"
                                            value={draft.name}
                                            disabled={managed}
                                            placeholder="例如：我的创作账号"
                                            onChange={(event) => patch({ name: event.target.value })}
                                        />
                                    </Form.Item>
                                    {managed ? (
                                        <Alert
                                            type="info"
                                            showIcon
                                            title="此连接由账号服务管理"
                                            description="连接地址和凭证由账号服务维护，可以在模型管理中查看模型。"
                                        />
                                    ) : (
                                        <>
                                            <Form.Item label={credential.apiKeyLabel} tooltip={credential.apiKeyHelp || "用于向服务商验证身份。填写当前服务提供的密钥。"}>
                                                <Input.Password
                                                    id={`channel-${draft.id}-api-key`}
                                                    prefix={<KeyRound size={15} />}
                                                    aria-label={credential.apiKeyLabel}
                                                    autoComplete="new-password"
                                                    placeholder={draft.hasApiKey ? "已保存；填写以替换" : credential.apiKeyPlaceholder}
                                                    value={draft.apiKey}
                                                    onChange={(event) => patch({ apiKey: event.target.value })}
                                                />
                                            </Form.Item>
                                            {credential.secretKeyRequired && (
                                                <Form.Item label={credential.secretKeyLabel} tooltip={credential.secretKeyHelp || "与上面的访问密钥成对使用，用于请求签名。"}>
                                                    <Input.Password
                                                        id={`channel-${draft.id}-secret-key`}
                                                        aria-label={credential.secretKeyLabel}
                                                        autoComplete="new-password"
                                                        value={draft.secretKey}
                                                        onChange={(event) => patch({ secretKey: event.target.value })}
                                                    />
                                                </Form.Item>
                                            )}
                                            <Form.Item label="服务地址" tooltip="模型服务的基础地址，例如 https://api.example.com/v1，不要填写具体的生成接口路径。">
                                                <Input
                                                    id={`channel-${draft.id}-base-url`}
                                                    aria-label="服务地址"
                                                    inputMode="url"
                                                    value={draft.baseUrl}
                                                    placeholder="https://api.example.com/v1"
                                                    onChange={(event) => patch({ baseUrl: event.target.value })}
                                                />
                                            </Form.Item>
                                            <Collapse
                                                ghost
                                                items={[
                                                    {
                                                        key: "advanced",
                                                        label: "高级连接设置",
                                                        children: (
                                                            <div>
                                                                {channelSupportsReferenceAssetOrigin(draft) && <>
                                                                <Form.Item label="素材服务地址" tooltip="向支持此配置的任务服务指定素材源站，例如 https://assets.example.com。当前浏览器直连不使用此项；它不是 Files 上传地址，可留空。">
                                                                    <Input
                                                                        aria-label="素材服务地址"
                                                                        value={draft.referenceAssetOrigin || ""}
                                                                        onChange={(event) => patch({ referenceAssetOrigin: event.target.value })}
                                                                    />
                                                                </Form.Item>
                                                                </>}
                                                                {servicePresetFor(draft) === "compatible" && (
                                                                    <Form.Item label="目录接口格式" tooltip="选择读取模型目录时使用的接口与鉴权格式，也参与默认协议推导。实际生成请求仍按每个模型选定的协议执行。">
                                                                        <Select
                                                                            aria-label="目录接口格式"
                                                                            value={draft.apiFormat}
                                                                            options={[
                                                                                { value: "openai", label: "OpenAI 兼容" },
                                                                                { value: "gemini", label: "Gemini 原生" },
                                                                            ]}
                                                                            onChange={(apiFormat) => patch({ apiFormat })}
                                                                        />
                                                                    </Form.Item>
                                                                )}
                                                                <ChannelHeadersEditor value={draft.headers} onChange={(headers) => patch({ headers })} />
                                                            </div>
                                                        ),
                                                    },
                                                ]}
                                            />
                                        </>
                                    )}
                                </Form>
                            ),
                        },
                        {
                            key: "models",
                            label: `模型管理${draft.models.length ? ` (${draft.models.length})` : ""}`,
                            children: (
                                <div className="model-service-models">
                                    <div className="model-service-catalog-header">
                                        <div>
                                            <h3>已启用模型</h3>
                                            <p>选择模型后，可查看能力并调整参数默认值。</p>
                                        </div>
                                        {!topaz && (
                                            <Button loading={busy} disabled={protocolLoading || saving} onClick={() => void fetchModels()}>
                                                {presetCatalog ? "选择预置模型" : "刷新目录"}
                                            </Button>
                                        )}
                                    </div>
                                    {!topaz && (
                                        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                                            <Tag>{presetCatalog ? "内置预设" : "接口目录"}</Tag>
                                            <span className="text-foreground/50">
                                                {presetCatalog
                                                    ? "预置列表不代表账号已开通"
                                                    : catalogState === "success"
                                                      ? "本次目录读取成功"
                                                      : catalogState === "error"
                                                        ? "本次目录读取失败"
                                                        : "本次尚未读取目录"}
                                            </span>
                                        </div>
                                    )}
                                    {catalogOpen && (
                                        <div className="mb-5 rounded-lg border border-[var(--workspace-border)] p-3">
                                            <Input
                                                aria-label="搜索模型目录"
                                                prefix={<Search size={14} />}
                                                placeholder="搜索模型目录"
                                                value={query}
                                                onChange={(event) => setQuery(event.target.value)}
                                                allowClear
                                            />
                                            <div className="model-service-catalog mt-3">
                                                {visibleModels.map((item) => (
                                                    <label key={item.id} className="model-service-model">
                                                        <Checkbox
                                                            disabled={busy}
                                                            checked={draft.models.includes(item.id)}
                                                            onChange={(event) => toggleModel(item.id, event.target.checked)}
                                                        />
                                                        <span>
                                                            <strong>{seedancePortraitLabel(item.id) || item.displayName || item.id}</strong>
                                                            {item.displayName && <small>{item.id}</small>}
                                                        </span>
                                                    </label>
                                                ))}
                                                {!visibleModels.length && (
                                                    <p className="py-5 text-center text-xs text-foreground/50">没有匹配的模型，可以在下方手动添加。</p>
                                                )}
                                            </div>
                                            <Button className="mt-2" type="text" size="small" onClick={() => setCatalogOpen(false)}>
                                                收起目录
                                            </Button>
                                        </div>
                                    )}
                                    {!topaz && (
                                        <div className="model-service-manual mb-5">
                                            <Input
                                                aria-label="模型 ID"
                                                placeholder="手动输入 Model ID / Endpoint ID"
                                                value={manualName}
                                                disabled={busy}
                                                onChange={(event) => setManualName(event.target.value)}
                                                onPressEnter={addManual}
                                            />
                                            {provider.families ? (
                                                <Select
                                                    aria-label="模型系列"
                                                    placeholder="模型系列"
                                                    value={manualFamily}
                                                    options={provider.families}
                                                    onChange={setManualFamily}
                                                />
                                            ) : (
                                                <Select
                                                    aria-label="模型类型"
                                                    placeholder="模型类型"
                                                    value={manualCapability}
                                                    options={Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }))}
                                                    onChange={setManualCapability}
                                                />
                                            )}
                                            <Button disabled={busy || protocolLoading || !manualName.trim()} onClick={addManual}>
                                                添加
                                            </Button>
                                        </div>
                                    )}
                                    {topaz ? (
                                        <p className="text-xs leading-6 text-foreground/55">
                                            已配置 {draft.models.length} 个超分接口，从图片或视频节点的「AI超分」中使用。
                                        </p>
                                    ) : protocolLoading ? (
                                        <Spin />
                                    ) : (
                                        <ChannelModelSettings
                                            channel={draft}
                                            onChange={(update) => {
                                                setDraft((current) => ({ ...current, modelProfiles: update(current.modelProfiles || []) }));
                                                setDirty(true);
                                                setError("");
                                            }}
                                            onRemove={(model) => patch({ models: draft.models.filter((item) => item !== model) })}
                                        />
                                    )}
                                    {modelCatalogRequestURL(draft) && (
                                        <p className="mt-5 break-all text-xs text-foreground/40">目录地址：{modelCatalogRequestURL(draft)}</p>
                                    )}
                                </div>
                            ),
                        },
                        ...(!topaz && !managed && referenceKinds.length > 0
                            ? [
                                  {
                                      key: "media",
                                      label: "素材传输",
                                      children: (
                                          <div className="model-service-fields">
                                              <ReferenceMediaTransportFields
                                                  kinds={referenceKinds}
                                                  filesAPI={provider.filesAPI}
                                                  filesAPIURL={provider.filesAPI ? buildApiUrl(draft.baseUrl, "/files") : undefined}
                                                  value={draft.referenceMediaTransport}
                                                  onChange={(referenceMediaTransport) => patch({ referenceMediaTransport })}
                                              />
                                              {channelSupportsPrivateAssetSync(draft) && (
                                                  <div className="mt-5 space-y-2">
                                                      <label className="flex items-center justify-between gap-3 text-xs">
                                                              <span>自动同步可信素材（确认拥有使用权） <Tag color="purple" className="!m-0">提供商扩展</Tag></span>
                                                          <Switch
                                                              aria-label="自动同步可信素材"
                                                              checked={draft.syncPrivateAssets !== false}
                                                              onChange={(syncPrivateAssets) => patch({ syncPrivateAssets })}
                                                          />
                                                      </label>
                                                      <p className="text-xs leading-5 text-foreground/50">
                                                          用于原方舟生成通道的可信素材处理，需要对应执行服务支持。
                                                      </p>
                                                  </div>
                                              )}
                                              <Alert
                                                  className="mt-5"
                                                  type="info"
                                                  showIcon
                                                  title="这里只设置生成时的发送方式"
                                                  description="导入素材仍保存在本地素材库；各模型只会使用实际支持的传输方式。"
                                              />
                                          </div>
                                      ),
                                  },
                              ]
                            : []),
                    ]}
                />
            </div>
            {(error || notice || credential.conflict) && (
                <div className="model-service-feedback">
                    {(error || credential.conflict) && <Alert type="error" showIcon title={error || credential.conflict} />}
                    {notice && <Alert type="info" showIcon title={notice} />}
                </div>
            )}
            <div className="model-service-footer flex-wrap">
                <span>{dirty ? "更改尚未保存" : "配置已保存"}</span>
                <div>
                    <Button disabled={saving || busy} onClick={onClose}>
                        取消
                    </Button>
                    {!managed && !topaz && <Button disabled={saving || busy} title="使用当前填写的连接信息检查接口，无需先保存。" onClick={() => { if (validateConnection(false)) setDirectTestOpen(true); }}>检查连接</Button>}
                    <Button type="primary" icon={<Check size={14} />} loading={saving} disabled={busy || protocolLoading || !dirty} onClick={() => void save()}>
                        保存
                    </Button>
                </div>
            </div>
            {directTestOpen && <ModelDirectTestModal channel={draft} onClose={() => setDirectTestOpen(false)} />}
        </section>
    );
}
