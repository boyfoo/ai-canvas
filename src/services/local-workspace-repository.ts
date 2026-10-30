import { sameCanvasDocument } from "@/lib/canvas/canvas-content";
import { canvasUnconfirmedDiagnostic, type CanvasUnconfirmedState } from "@/lib/canvas/canvas-unconfirmed-edits";
import { getActiveUserScope } from "@/lib/user-scope";
import { preserveCanvasSyncDraft, readCanvasSyncDrafts } from "@/services/canvas-sync-drafts";
import { notifyCanvasRefresh } from "@/services/local-workspace-sync";
import { beginCanvasHydration, finishCanvasHydration } from "@/services/canvas-hydration-health";
import { acceptCanvasExternalRevisionCandidate, applyExternalCanvasRevision, canvasDurableSnapshot, canvasExternalRevisionConflict, flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { projectSyncProgress, useSyncProgressStore } from "@/stores/use-sync-progress-store";

type LocalCanvasContent = Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>;
type CanvasDocumentPersistPatch = Partial<Pick<CanvasProject, "nodes" | "connections" | "timeline" | "chatSessions" | "activeChatId" | "appearance" | "backgroundMode" | "showImageInfo" | "title" | "folderId" | "directorScenes">>;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function openLocalCanvasProject(id: string) {
    return useCanvasStore.getState().openProject(id);
}

function unconfirmedState(id: string): CanvasUnconfirmedState {
    const scope = getActiveUserScope();
    const progress = projectSyncProgress(id, scope);
    return {
        live: openLocalCanvasProject(id) ?? undefined,
        durable: canvasDurableSnapshot(scope, id),
        pending: progress?.phase === "pending" || progress?.phase === "saving" || progress?.phase === "error",
        blocked: Boolean(canvasExternalRevisionConflict(scope, id)),
        inFlight: false,
        pendingProjection: false,
    };
}

export function getUnconfirmedCanvasDiagnostic(id: string) {
    return canvasUnconfirmedDiagnostic(unconfirmedState(id));
}

export function hasUnconfirmedCanvasEdits(id: string) {
    const state = unconfirmedState(id);
    return Boolean(state.live && (state.pending || state.blocked || !state.durable || !sameCanvasDocument(state.live, state.durable)));
}

/** 只有 IndexedDB 完成写入后才发布保存成功；写入失败保留待保存内容。 */
export async function saveLocalCanvasProject(id: string) {
    if (!openLocalCanvasProject(id)) throw new Error("本地画布不存在");
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
    const scope = getActiveUserScope();
    const progress = useSyncProgressStore.getState().setProjectProgress;
    progress(id, { phase: "saving", message: "正在保存到浏览器本地存储" }, scope);
    try {
        await flushCanvasStorePersistence();
        progress(id, { phase: "done", message: "已保存在浏览器本地存储" }, scope);
    } catch (error) {
        progress(id, { phase: "error", message: error instanceof Error ? error.message : "本地保存失败，请重试" }, scope);
        throw error;
    }
}

export function scheduleLocalCanvasSave(id: string) {
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    useSyncProgressStore.getState().setProjectProgress(id, { phase: "pending", message: "等待保存到浏览器本地存储" });
    saveTimers.set(id, setTimeout(() => {
        saveTimers.delete(id);
        void saveLocalCanvasProject(id).catch((error) => console.error("本地画布保存失败", error));
    }, 500));
}

export function beginLocalCanvasProject(title: string, projectId?: string, initialContent?: LocalCanvasContent, workspaceProjectId?: string) {
    const id = useCanvasStore.getState().createProject(title, projectId, workspaceProjectId);
    if (initialContent) useCanvasStore.getState().updateProject(id, initialContent);
    return { id, saved: saveLocalCanvasProject(id) };
}

export async function createLocalCanvasProject(title: string, projectId?: string, initialContent?: LocalCanvasContent, workspaceProjectId?: string) {
    const { id, saved } = beginLocalCanvasProject(title, projectId, initialContent, workspaceProjectId);
    await saved;
    return { id };
}

export async function hydrateLocalCanvasProjects() {
    const attempt = beginCanvasHydration();
    try {
        await useCanvasStore.persist.rehydrate();
        finishCanvasHydration(attempt);
    } catch (error) {
        finishCanvasHydration(attempt, error instanceof Error ? error.message : "读取本地画布失败");
        throw error;
    }
}

export async function loadLocalCanvasProject(id: string) {
    return openLocalCanvasProject(id) ?? undefined;
}

export async function readLocalCanvasProject(id: string): Promise<CanvasProject> {
    const project = openLocalCanvasProject(id);
    if (!project) throw new Error("本地画布不存在");
    await saveLocalCanvasProject(id);
    return project;
}

export async function persistCanvasDocument(id: string, patch: CanvasDocumentPersistPatch) {
    if (!openLocalCanvasProject(id)) throw new Error("本地画布不存在");
    useCanvasStore.getState().updateProject(id, patch);
    await saveLocalCanvasProject(id);
}

export async function persistCanvasTimeline(id: string, timeline: NonNullable<CanvasProject["timeline"]>) {
    await persistCanvasDocument(id, { timeline });
}

export async function refreshLocalCanvasProjectIfChanged(id: string) {
    const previous = openLocalCanvasProject(id);
    await flushCanvasStorePersistence();
    await hydrateLocalCanvasProjects();
    const project = openLocalCanvasProject(id);
    if (project && previous && !sameCanvasDocument(project, previous)) notifyCanvasRefresh(project, previous);
    return project ?? undefined;
}

export function holdExternalCanvasRevisionForEditor(project: CanvasProject, scope = getActiveUserScope()) {
    applyExternalCanvasRevision(project, { scope, hasUnsyncedEdits: true });
}

export function pendingExternalCanvasRevision(id: string) {
    return canvasExternalRevisionConflict(getActiveUserScope(), id);
}

export async function acceptExternalCanvasRevision(id: string) {
    const project = openLocalCanvasProject(id);
    if (project) await preserveCanvasSyncDraft(project);
    const decision = acceptCanvasExternalRevisionCandidate(id, { onApplied: notifyCanvasRefresh });
    await saveLocalCanvasProject(id);
    return decision?.kind === "apply" ? decision.project : undefined;
}

export async function restoreLocalCanvasProjectFromHistory(id: string, options: { snapshotId: string; revision: number }) {
    const drafts = await readCanvasSyncDrafts(id);
    const snapshot = drafts.find((draft) => draft.id === options.snapshotId);
    if (!snapshot) throw new Error("本地版本记录不存在");
    const previous = openLocalCanvasProject(id);
    if (previous) await preserveCanvasSyncDraft(previous);
    useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => project.id === id ? snapshot.project : project) }));
    await saveLocalCanvasProject(id);
    notifyCanvasRefresh(snapshot.project, previous ?? undefined);
    return snapshot.project;
}

export async function deleteLocalCanvasProjects(ids: readonly string[]) {
    const selected = [...new Set(ids)];
    const snapshots = selected.map(openLocalCanvasProject).filter((project): project is CanvasProject => Boolean(project));
    selected.forEach((id) => {
        const timer = saveTimers.get(id);
        if (timer) clearTimeout(timer);
        saveTimers.delete(id);
    });
    useCanvasHistoryStore.getState().recordDeletedProjects(snapshots);
    useCanvasStore.getState().deleteProjects(selected);
    await flushCanvasStorePersistence();
    selected.forEach((id) => useSyncProgressStore.getState().setProjectProgress(id, null));
    return snapshots;
}
