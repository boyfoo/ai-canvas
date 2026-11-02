import { Alert, App, Button, Popconfirm } from "antd";
import { Bug, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { PageHeader } from "@/components/layout/workspace-page";
import { mergeFetchedChannelModelProfiles } from "@/lib/channel-model-catalog";
import { seedancePortraitModel } from "@/lib/seedance-portrait";
import { fetchChannelModels, type ChannelModelFetchResult } from "@/services/api/image";
import { channelConnectionSignature, channelHasGenerationCredential, channelHasManagedBeefAPICredential, filterModelsByCapability, isBuiltinBeefAPIChannel, modelOptionsFromChannels, normalizeConfigSnapshot, useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { ModelServiceEditor } from "./model-service-editor";
import { currentModelConnectionReceipt, useModelConnectionTests } from "@/stores/use-model-connection-tests";
import { ModelLogo } from "@/components/model-logo";
import beefTVAppIcon from "@/assets/app-icon.png";
import { MODEL_SERVICE_PRESETS, isTopazUpscaleChannel, channelAllowsEmptyAPIKey, modelCatalogSource, modelProviderDefinition, serviceConnectionError, servicePresetFor } from "@/lib/model-service-presets";
import { workspaceCapabilities } from "@/services/workspace-mode";
import { localWorkspaceConfig } from "@/lib/user-session";
import { readModelConfig } from "@/services/model-config-repository";
import { commitModelConfig, flushModelConfig, getModelConfigPersistenceState, subscribeModelConfigPersistence, type ModelConfigPersistenceState } from "@/services/model-config-repository";
import { createChannelCatalogRequests } from "@/services/channel-catalog-requests";
import { getTransportFailureKind } from "@/services/api/request";
import { beefAPIConnectionLabel, cancelBeefAPIConnection, disconnectBeefAPIConnection, getBeefAPIConnection, openBeefAPIWallet, startBeefAPIConnection, type BeefAPIConnectionSummary } from "@/services/api/beefapi-connection";
import { recordChannelDelete, recordChannelDeleteConfirmOpen } from "./model-settings-diagnostics";

type ChannelSettingsPaneProps = {
    onEditingChange?: (editing: boolean) => void;
    onOpenDiagnostics?: () => void;
    onOpenRunningHub?: () => void;
};

export function ChannelSettingsPane({ onOpenDiagnostics, onOpenRunningHub, onEditingChange }: ChannelSettingsPaneProps) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const localMode = workspaceCapabilities().local;
    const persistence = useSyncExternalStore(subscribeModelConfigPersistence, getModelConfigPersistenceState, getModelConfigPersistenceState);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [serviceEditor, setServiceEditor] = useState<ModelChannel | null | undefined>(undefined);
    const [editorDirty, setEditorDirty] = useState(false);
    const [editorEpoch, setEditorEpoch] = useState(0);
    useEffect(() => { onEditingChange?.(editorDirty); return () => onEditingChange?.(false); }, [editorDirty, onEditingChange]);
    const [beefConnection, setBeefConnection] = useState<BeefAPIConnectionSummary | null>(null);
    const [beefBusy, setBeefBusy] = useState(false);
    const appliedConnectionState = useRef<string | undefined>(undefined);
    const catalogSync = useRef<{ state: string; selection: string; adopt: boolean } | null>(null);
    const [catalogSyncFailed, setCatalogSyncFailed] = useState(false);
    const requests = useRef(createChannelCatalogRequests());
    const deleting = useRef(new Set<string>());
    const [deleteFailures, setDeleteFailures] = useState<Record<string, string>>({});
    useEffect(() => {
        const editConnection = (event: Event) => {
            const id = (event as CustomEvent<{ channel_id: string }>).detail.channel_id;
            const channel = useConfigStore.getState().config.channels.find(item => item.id === id);
            if (channel) { setServiceEditor(channel); setEditorEpoch(value => value + 1); }
        };
        window.addEventListener("canvas:edit-model-connection", editConnection);
        return () => window.removeEventListener("canvas:edit-model-connection", editConnection);
    }, []);
    useEffect(() => () => requests.current.cancelAll(), []);
    const cancelCatalog = (id: string) => {
        requests.current.cancel(id);
        setLoadingChannelIds((items) => items.filter((item) => item !== id));
    };

    const applyBeefConnection = async (summary: BeefAPIConnectionSummary, previousState = beefConnection?.state) => {
        setBeefConnection(summary);
        const retry = catalogSync.current?.state === summary.state ? catalogSync.current : null;
        if (appliedConnectionState.current === summary.state && !retry) return;
        appliedConnectionState.current = summary.state;
        if (!retry && !shouldRefreshBeefAPICatalog(previousState, summary.state)) {
            catalogSync.current = null;
            setCatalogSyncFailed(false);
            return;
        }
        const intent = retry || { state: summary.state, selection: useConfigStore.getState().config.assistantModel, adopt: summary.state === "connected" && Boolean(previousState && previousState !== "connected") };
        catalogSync.current = intent;
        try {
            const result = await readModelConfig();
            if (catalogSync.current !== intent) return;
            const current = useConfigStore.getState().config;
            replaceConfig(localWorkspaceConfig(normalizeConfigSnapshot({
                config: mergeManagedBeefAPICatalog(current, result.config, intent.adopt && current.assistantModel === intent.selection),
            }).config));
            catalogSync.current = null;
            setCatalogSyncFailed(false);
        } catch {
            if (catalogSync.current === intent) setCatalogSyncFailed(true);
            // Keep the connection status even if the catalog refresh fails.
        }
    };

    useEffect(() => {
        let cancelled = false;
        void getBeefAPIConnection()
            .then((summary) => {
                if (!cancelled) void applyBeefConnection(summary, undefined);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (beefConnection?.state !== "pending" && beefConnection?.state !== "connecting") return;
        let active = true;
        const timer = window.setInterval(() => {
            void getBeefAPIConnection()
                .then((summary) => { if (active) void applyBeefConnection(summary, beefConnection?.state); })
                .catch(() => undefined);
        }, 2000);
        return () => { active = false; window.clearInterval(timer); };
    }, [beefConnection?.state]);

    const runBeefAction = async (action: () => Promise<BeefAPIConnectionSummary>, fallback: string) => {
        setBeefBusy(true);
        const previousConnection = beefConnection;
        const previousState = beefConnection?.state;
        try {
            const summary = await action();
            await applyBeefConnection(summary, previousState);
        } catch (error) {
            try {
                await applyBeefConnection(await getBeefAPIConnection(), previousState);
            } catch {
                setBeefConnection(previousConnection);
            }
            message.error(error instanceof Error ? error.message : fallback);
        } finally {
            setBeefBusy(false);
        }
    };
    const beginBeefConnection = () => {
        setBeefConnection({ state: "connecting", hasCredential: beefConnection?.hasCredential || false });
        return startBeefAPIConnection();
    };
    const retryBeefConnection = async () => {
        const state = beefConnection?.state;
        if (state === "expired" || state === "revoked" || state === "rejected") {
            await disconnectBeefAPIConnection();
        }
        return beginBeefConnection();
    };
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const runningHubReady = Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim() && config.runningHub.workflowId.trim());

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const addChannel = () => {
        setServiceEditor(null);
        setEditorEpoch(value => value + 1);
    };

    const saveService = async (channel: ModelChannel) => {
        cancelCatalog(channel.id);
        const latest = useConfigStore.getState().config;
        const channels = latest.channels.some((item) => item.id === channel.id)
            ? latest.channels.map((item) => item.id === channel.id ? channel : item)
            : [...latest.channels, channel];
        updateChannels(channels, latest);
        await flushModelConfig();
        const saved = getModelConfigPersistenceState();
        if (saved.status === "error" || saved.dirty) throw new Error(saved.error || "模型服务尚未保存，请重试");
        setServiceEditor(channel);
        setEditorDirty(false);
        message.success("连接已保存，可在画布中选择模型");
    };

    const deleteChannel = async (id: string) => {
        if (deleting.current.has(id)) return;
        const latest = useConfigStore.getState().config;
        const channel = latest.channels.find((item) => item.id === id);
        if (channel && (channel.scope === "system" || isBuiltinBeefAPIChannel(channel))) {
            message.warning("系统连接由管理员维护");
            return;
        }
        deleting.current.add(id);
        cancelCatalog(id);
        const next = withChannels(latest, latest.channels.filter((item) => item.id !== id));
        replaceConfig(next);
        try {
            await commitModelConfig(next);
            await flushModelConfig();
            const saved = getModelConfigPersistenceState();
            if (saved.status === "error" || saved.dirty) throw new Error(saved.error || "删除尚未保存");
            setDeleteFailures((items) => { const next = { ...items }; delete next[id]; return next; });
            recordChannelDelete({ scope: channel?.scope, before: latest.channels.length, after: next.channels.length });
            message.success("连接已删除并保存");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "保存失败";
            setDeleteFailures((items) => ({ ...items, [id]: `${channel?.name || "连接"}删除尚未保存：${detail}。请重试，重新加载可能恢复原连接。` }));
        } finally {
            deleting.current.delete(id);
        }
    };

    const setChannelLoading = (id: string, loading: boolean) => {
        setLoadingChannelIds((items) => (loading ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id)));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (isTopazUpscaleChannel(channel)) return;
        const connectionError = channelConnectionError(channel, isBuiltinBeefAPIChannel(channel) ? beefConnection : null);
        if (connectionError) {
            message.error(`${channel.name || "当前连接"}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        const request = requests.current.start(channel.id);
        try {
            const result = await fetchChannelModels(channel, request.signal);
            if (!requests.current.current(channel.id, request)) return;
            if (!result.models.length) {
                message.warning(`${channel.name || "当前连接"}未返回模型，已保留现有手工模型`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(`${latestChannel.name || "当前连接"}的连接配置已改变，已忽略旧的读取结果`);
                return;
            }
            if (localMode && isBuiltinBeefAPIChannel(latestChannel)) {
                const server = await readModelConfig();
                if (!requests.current.current(channel.id, request)) return;
                const current = useConfigStore.getState().config;
                replaceConfig(localWorkspaceConfig(normalizeConfigSnapshot({
                    config: mergeManagedBeefAPICatalog(current, server.config),
                }).config));
            } else {
                updateChannels(
                    latestConfig.channels.map((item) => (item.id === channel.id ? applyFetchedChannelModelCatalog(item, result) : item)),
                    latestConfig,
                );
            }
            await flushModelConfig();
            message.success(`${latestChannel.name || "当前连接"}模型列表已更新`);
        } catch (error) {
            if (requests.current.current(channel.id, request)) message.error(channelModelFetchErrorMessage(error));
        } finally {
            if (requests.current.current(channel.id, request)) setChannelLoading(channel.id, false);
            requests.current.finish(channel.id, request);
        }
    };

    const refreshAllModels = async () => {
        const catalogChannels = userChannels.filter(channel => !isTopazUpscaleChannel(channel) && modelCatalogSource(channel) === "remote");
        const runnable = catalogChannels.filter((channel) => !channelConnectionError(channel, isBuiltinBeefAPIChannel(channel) ? beefConnection : null));
        const skipped = catalogChannels.filter((channel) => channelConnectionError(channel, isBuiltinBeefAPIChannel(channel) ? beefConnection : null));
        if (!runnable.length) {
            const detail = skipped.map((channel) => `${channel.name || "未命名连接"}：${channelConnectionError(channel, isBuiltinBeefAPIChannel(channel) ? beefConnection : null)}`).join("；");
            message.error(detail || "没有可读取的个人模型连接，请先填写有效 Base URL 和 API Key");
            return;
        }
        setChannelLoading("all", true);
        const batch = new Map<string, AbortController>();
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    const request = requests.current.start(channel.id);
                    batch.set(channel.id, request);
                    try {
                        const result = await fetchChannelModels(channel, request.signal);
                        if (!requests.current.current(channel.id, request)) return { channel, result: { models: [], catalog: [] }, error: "", cancelled: true };
                        return { channel, result, error: "" };
                    } catch (error) {
                        if (!requests.current.current(channel.id, request)) return { channel, result: { models: [], catalog: [] }, error: "", cancelled: true };
                        return { channel, result: { models: [], catalog: [] }, error: channelModelFetchErrorMessage(error) };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && latestChannel && requests.current.current(item.channel.id, batch.get(item.channel.id)!) && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.cancelled && !item.result.models.length);
            if (successful.length) {
                const resultMap = new Map(successful.map((item) => [item.channel.id, item.result] as const));
                const refreshedManagedBeefAPI = localMode && successful.some((item) => isBuiltinBeefAPIChannel(item.channel));
                const server = refreshedManagedBeefAPI ? await readModelConfig() : null;
                const current = useConfigStore.getState().config;
                const nextChannels = current.channels.map((channel) => {
                    if (refreshedManagedBeefAPI && isBuiltinBeefAPIChannel(channel)) return channel;
                    const fetched = resultMap.get(channel.id);
                    return fetched ? applyFetchedChannelModelCatalog(channel, fetched) : channel;
                });
                const updated = withChannels(current, nextChannels);
                replaceConfig(server ? localWorkspaceConfig(normalizeConfigSnapshot({
                    config: mergeManagedBeefAPICatalog(updated, server.config),
                }).config) : updated);
                await flushModelConfig();
                message.success(`已更新 ${successful.length} 个连接的模型`);
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || "未命名连接"}：${item.error || "未返回模型"}`),
                ...stale.map((item) => `${item.channel.name || "未命名连接"}：连接配置已改变，已忽略旧结果`),
                ...skipped.map((channel) => `${channel.name || "未命名连接"}：${channelConnectionError(channel, isBuiltinBeefAPIChannel(channel) ? beefConnection : null)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("；")}。未更新的连接已保留原有模型列表`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量读取模型失败，原有模型列表未改动");
        } finally {
            for (const [id, request] of batch) requests.current.finish(id, request);
            setChannelLoading("all", false);
        }
    };

    const selectedChannel = serviceEditor === null ? undefined : userChannels.find(channel => channel.id === serviceEditor?.id) || userChannels[0];
    const selectedId = serviceEditor === null ? "new" : selectedChannel?.id;
    const closeEditor = () => { setEditorDirty(false); setEditorEpoch(value => value + 1); if (serviceEditor === null) setServiceEditor(undefined); };
    return <div>
        {Object.entries(deleteFailures).map(([id, detail]) => <Alert key={id} type="error" showIcon title={detail} action={<Button onClick={() => void deleteChannel(id)}>重试删除</Button>} />)}
        <PageHeader title="连接管理" actions={<div className="settings-pane-header-actions flex w-full flex-wrap gap-2 sm:w-auto">
            {onOpenDiagnostics && <Button icon={<Bug size={14} />} onClick={onOpenDiagnostics}>问题诊断</Button>}
            <Button icon={<RefreshCw size={14} />} loading={loadingChannelIds.includes("all")} disabled={editorDirty || loadingChannelIds.some(id => id !== "all") || !userChannels.some(channel => !isTopazUpscaleChannel(channel) && modelCatalogSource(channel) === "remote")} onClick={() => void refreshAllModels()}>刷新接口目录</Button>
            <Button type="primary" icon={<Plus size={14} />} disabled={editorDirty} onClick={addChannel}>添加连接</Button>
        </div>} />
        {onOpenRunningHub && <section className="settings-section mb-3"><WorkflowChannelEntry icon={<Workflow size={16} />} title="RunningHub 工作流" description="独立的工作流字段与执行配置" status={runningHubReady ? `${config.runningHub.workflows.length} 个工作流已配置` : "待配置"} ready={runningHubReady} onOpen={onOpenRunningHub} /></section>}
        {editorDirty && <p className="mb-3 text-xs text-foreground/50" role="status">当前连接有未保存更改，保存或取消后可以切换连接。</p>}
        {userChannels.length || serviceEditor === null ? <div className="model-connections-layout">
            <nav className="model-connections-list" aria-label="模型连接列表">
                {serviceEditor === null && <div className="model-connection-entry is-selected"><span className="text-sm font-medium">新连接</span></div>}
                {userChannels.map(channel => {
                    const builtin = isBuiltinBeefAPIChannel(channel);
                    return <div key={channel.id} className={`model-connection-entry ${channel.id === selectedId ? "is-selected" : ""}`}>
                        <button type="button" disabled={editorDirty} aria-pressed={channel.id === selectedId} className="min-w-0 flex-1 text-left" onClick={() => { cancelCatalog(channel.id); setServiceEditor(channel); }}>
                            <span className="flex items-center gap-2 text-sm font-medium">{builtin ? <img src={beefTVAppIcon} alt="" className="size-5 object-contain" /> : <ModelLogo icon={MODEL_SERVICE_PRESETS.find(item => item.id === servicePresetFor(channel))?.icon} size={20} />}<span className="truncate">{channel.name || "未命名连接"}</span></span>
                            <span className="mt-2 block text-xs text-foreground/50">{builtin ? "账号连接" : MODEL_SERVICE_PRESETS.find(item => item.id === servicePresetFor(channel))?.name} · {channel.models.length} 个模型</span>
                            <span className="mt-2 block"><ChannelStatus channel={channel} persistence={persistence} connection={builtin ? beefConnection : null} /></span>
                        </button>
                        {!builtin && <Popconfirm title="删除连接？" description="此连接下的模型选择会同时移除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onOpenChange={recordChannelDeleteConfirmOpen} onConfirm={() => deleteChannel(channel.id)}><Button type="text" size="small" danger disabled={editorDirty} aria-label={`删除连接 ${channel.name}`} icon={<Trash2 size={14} />} /></Popconfirm>}
                    </div>;
                })}
            </nav>
            <div className="min-w-0">
                {selectedChannel && isBuiltinBeefAPIChannel(selectedChannel) && <section className="settings-channel mb-3 flex flex-wrap items-center justify-between gap-3 p-3"><span className="text-xs">{beefAPIConnectionLabel(beefConnection)}</span><div className="flex flex-wrap gap-2"><BeefAPIConnectionActions connection={beefConnection} busy={beefBusy} onConnect={() => void runBeefAction(beginBeefConnection, "无法开始连接")} onCancel={() => void runBeefAction(cancelBeefAPIConnection, "无法取消连接")} onRetry={() => void runBeefAction(retryBeefConnection, "无法重新连接")} onDisconnect={() => void runBeefAction(disconnectBeefAPIConnection, "无法断开连接")} onWallet={() => { void openBeefAPIWallet().catch(error => message.error(error instanceof Error ? error.message : "无法打开账户")); }} />{catalogSyncFailed && <Button onClick={() => void runBeefAction(getBeefAPIConnection, "无法更新模型列表")}>重试目录同步</Button>}<Button disabled={editorDirty || beefConnection?.state !== "connected"} loading={loadingChannelIds.includes(selectedChannel.id)} onClick={() => void refreshChannelModels(selectedChannel)}>刷新模型目录</Button></div></section>}
                <ModelServiceEditor key={`${selectedId}:${editorEpoch}`} initial={serviceEditor === null ? undefined : selectedChannel} onClose={closeEditor} onSave={saveService} onDirtyChange={setEditorDirty} />
            </div>
        </div> : <WorkspaceState icon="settings" compact title="添加第一个模型连接" action={<Button icon={<Plus size={16} />} onClick={addChannel}>添加连接</Button>} />}
    </div>;
}

export function applyFetchedChannelModelCatalog(channel: ModelChannel, result: ChannelModelFetchResult): ModelChannel {
    const provider = modelProviderDefinition(channel);
    const profiles = provider.createProfile ? result.models.map(model => channel.modelProfiles?.find(profile => profile.model === model) || provider.createProfile!(model)) : mergeFetchedChannelModelProfiles(channel, result.catalog);
    if (channel.id === "beefapi") return { ...channel, models: uniqueModels(result.models), modelProfiles: profiles };
    const existing = new Map((channel.modelProfiles || []).map((profile) => [profile.model, profile]));
    // Refresh updates the catalog without silently enabling new models or removing manual ones.
    return {
        ...channel,
        models: channel.models.length ? channel.models : uniqueModels(result.models),
        modelProfiles: profiles.map((profile) => {
            const previous = existing.get(profile.model);
            if (!previous) return profile;
            if (seedancePortraitModel(profile.model)) return { ...previous, videoPricing: profile.videoPricing ?? null };
            return profile.videoPricing ? { ...previous, videoPricing: profile.videoPricing } : previous;
        }).concat((channel.modelProfiles || []).filter((profile) => !profiles.some((item) => item.model === profile.model))
            .map((profile) => seedancePortraitModel(profile.model) ? { ...profile, videoPricing: null } : profile)),
    };
}

function WorkflowChannelEntry({ icon, title, description, status, ready, onOpen }: { icon: ReactNode; title: string; description: string; status: string; ready: boolean; onOpen?: () => void }) {
    return (
        <div className="settings-channel flex min-w-0 items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true">
                    {icon}
                </span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
                    <span className={`settings-channel-status mt-1.5 ${ready ? "is-ready" : "is-warning"}`}>
                        <i aria-hidden="true" />
                        {status}
                    </span>
                </div>
            </div>
            <Button size="small" onClick={onOpen} disabled={!onOpen}>
                配置
            </Button>
        </div>
    );
}

export function channelValidationError(channel: ModelChannel, connection?: BeefAPIConnectionSummary | null) {
    return channelConnectionError(channel, connection) || validateChannelHeaders(channel.headers) || (!channel.models.length ? "请添加至少一个模型" : "");
}

export function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

export function focusInvalidChannelField(channel: ModelChannel) {
    window.dispatchEvent(new CustomEvent("canvas:edit-model-connection", { detail: { channel_id: channel.id } }));
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid", secretKey: "valid" });
    const field = baseUrlError ? "base-url" : !channelHasGenerationCredential(channel) && !channelAllowsEmptyAPIKey(channel) ? "api-key" : requiresSecretKey(channel) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    }));
}

function ChannelStatus({ channel, persistence, connection }: { channel: ModelChannel; persistence: ModelConfigPersistenceState; connection?: BeefAPIConnectionSummary | null }) {
    const receipts = useModelConnectionTests((state) => state.receipts);
    const tested = channel.models.map((model) => currentModelConnectionReceipt(receipts, channel, model));
    const passed = tested.filter((result) => result?.success).length;
    const failed = tested.filter((result) => result && !result.success).length;
    const error = channelValidationError(channel, connection);
    const label = modelConfigChannelStatusLabel(channel, persistence, connection);
    const testLabel = failed ? `${failed} 个模型测试失败` : passed ? `${passed}/${channel.models.length} 个模型测试通过` : label;
    return (
        <span className={`settings-channel-status ${error || failed ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {isBuiltinBeefAPIChannel(channel) ? label : error || (persistence.status === "saving" || persistence.status === "error" ? label : testLabel)}
        </span>
    );
}

export function shouldRefreshBeefAPICatalog(previous: string | undefined, next: string) {
    if (next === "connected" && previous !== "connected") return true;
    return next === "disconnected" && Boolean(previous) && previous !== "disconnected";
}

export function mergeManagedBeefAPICatalog(current: AiConfig, server: AiConfig, adoptAuthorizedAssistant = false): AiConfig {
    const serverBeef = server.channels.find((channel) => channel.id === "beefapi");
    let found = false;
    const channels = current.channels.map((channel) => {
        if (channel.id !== "beefapi") return channel;
        found = true;
        if (!serverBeef) {
            return { ...channel, models: [], modelProfiles: [], apiKey: "", secretKey: "", credentialRef: undefined, hasApiKey: false, hasSecretKey: false };
        }
        return {
            ...channel,
            models: [...(serverBeef.models || [])],
            modelProfiles: (serverBeef.modelProfiles || []).map((item) => ({ ...item })),
            apiKey: "",
            secretKey: "",
            credentialRef: serverBeef.credentialRef,
            hasApiKey: serverBeef.hasApiKey,
            hasSecretKey: serverBeef.hasSecretKey,
            baseUrl: serverBeef.baseUrl || channel.baseUrl,
        };
    });
    if (serverBeef && !found) {
        channels.unshift({
            ...serverBeef,
            apiKey: "",
            secretKey: "",
            models: [...(serverBeef.models || [])],
            modelProfiles: (serverBeef.modelProfiles || []).map((item) => ({ ...item })),
        });
    }
    return withChannels(adoptAuthorizedAssistant ? { ...current, assistantModel: server.assistantModel } : current, channels);
}

export function modelConfigChannelStatusLabel(channel: ModelChannel, persistence: ModelConfigPersistenceState, connection?: BeefAPIConnectionSummary | null) {
    if (isBuiltinBeefAPIChannel(channel)) {
        if (connection?.state === "connected") return beefAPIConnectionLabel(connection);
        if (connection?.state && connection.state !== "disconnected") return beefAPIConnectionLabel(connection);
        if (channelHasManagedBeefAPICredential(channel)) return "待确认连接";
        return "未连接";
    }
    return serviceConnectionError(channel);
}

export function BeefAPIConnectionActions({
    connection,
    busy,
    onConnect,
    onCancel,
    onRetry,
    onDisconnect,
    onWallet,
}: {
    connection: BeefAPIConnectionSummary | null;
    busy: boolean;
    onConnect: () => void;
    onCancel: () => void;
    onRetry: () => void;
    onDisconnect: () => void;
    onWallet: () => void;
}) {
    const state = connection?.state || "disconnected";
    const buttonClass = "h-10 sm:h-8";
    if (state === "connecting") {
        return <Button className={buttonClass} size="small" loading disabled>正在连接</Button>;
    }
    if (state === "pending") {
        return (
            <>
                <Button className={buttonClass} size="small" loading={busy} onClick={onCancel}>
                    取消
                </Button>
            </>
        );
    }
    if (state === "connected") {
        return (
            <>
                <Button className={buttonClass} size="small" onClick={onWallet}>
                    打开 BeefTV 账户
                </Button>
                <Button className={buttonClass} size="small" loading={busy} onClick={onDisconnect}>
                    断开连接
                </Button>
            </>
        );
    }
    if (state === "catalog_failed") {
        return (
            <>
                <Button className={buttonClass} size="small" type="primary" loading={busy} onClick={onRetry}>
                    重新连接
                </Button>
                <Button className={buttonClass} size="small" loading={busy} onClick={onDisconnect}>
                    断开连接
                </Button>
            </>
        );
    }
    if (state === "expired" || state === "revoked" || state === "rejected" || state === "store_error" || state === "connection_error" || state === "cancelled") {
        return (
            <Button data-onboarding="official-connect" className={buttonClass} size="small" type="primary" loading={busy} onClick={onRetry}>
                重新连接
            </Button>
        );
    }
    return (
        <Button data-onboarding="official-connect" className={buttonClass} size="small" type="primary" loading={busy} onClick={onConnect}>
            连接 BeefTV
        </Button>
    );
}

export function modelConfigChannelPresentation(channel: ModelChannel) {
    const builtin = isBuiltinBeefAPIChannel(channel);
    return {
        builtin,
        deletable: !builtin,
        adapterLabel: builtin ? "应用内置适配" : "",
    };
}

export function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return {
        ...config,
        channels,
        models,
        model: normalizeDefaultModel(config.model, models),
        assistantModel: config.channels.some((channel) => !channels.some((item) => item.id === channel.id) && config.assistantModel?.startsWith(`${channel.id}::`)) ? "" : config.assistantModel,
        mediaReviewModel: config.channels.some((channel) => !channels.some((item) => item.id === channel.id) && config.mediaReviewModel?.startsWith(`${channel.id}::`)) ? "" : config.mediaReviewModel,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown) {
    if (getTransportFailureKind(error) === "network") return "模型目录请求失败，可能是网络或接口跨域限制；可以手动添加模型，生成验证需单独进行";
    if (getTransportFailureKind(error) === "timeout") return "读取模型目录超时，请检查地址和网络后重试；也可以手动添加模型 ID";
    const detail = error instanceof Error ? error.message : "读取模型失败";
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

function channelConnectionError(channel: ModelChannel, connection?: BeefAPIConnectionSummary | null) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return "请填写 Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL 只支持 HTTP 或 HTTPS";
    } catch {
        return "Base URL 格式不正确";
    }
    if (isBuiltinBeefAPIChannel(channel)) {
        if (connection?.state === "connected" || channelHasManagedBeefAPICredential(channel)) return "";
        return "请先连接 BeefTV";
    }
    if (!channelHasGenerationCredential(channel) && !channelAllowsEmptyAPIKey(channel)) return "请填写 API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return "当前协议需要填写 Secret Key";
    return "";
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.modelProfiles?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
