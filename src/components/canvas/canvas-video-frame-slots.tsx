import { App } from "antd";
import { useState, type DragEvent } from "react";
import { ArrowLeftRight, ImagePlus, LoaderCircle, X } from "lucide-react";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { usePersonalAssetLibrary } from "@/hooks/use-personal-asset-library";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasVideoFrameRole, CanvasVideoFrameSource } from "@/lib/canvas/canvas-video-frames";
import { resolveVideoFrameIds } from "@/lib/video-frame-selection";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

/** 沿用素材库选择器、图片缓存和主题；图片位只负责角色展示，连线及导入由画布宿主处理。 */
export function CanvasVideoFrameSlots({ metadata, references, availableReferences, endFrameSupported, onChange, onMetadataChange }: {
    metadata?: CanvasNodeMetadata;
    references: CanvasResourceReference[];
    availableReferences: CanvasResourceReference[];
    endFrameSupported: boolean;
    onChange: (role: CanvasVideoFrameRole, source?: CanvasVideoFrameSource) => Promise<void>;
    onMetadataChange: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const { message } = App.useApp();
    const assets = usePersonalAssetLibrary();
    const [pickerRole, setPickerRole] = useState<CanvasVideoFrameRole | null>(null);
    const [busy, setBusy] = useState(false);
    const images = references.filter((reference) => reference.kind === "image");
    const frames = resolveVideoFrameIds(images.map((reference) => reference.nodeId), metadata, endFrameSupported);
    const items: AssetLibraryPickerItem[] = [
        ...availableReferences.filter((reference) => reference.kind === "image").map((reference) => ({ id: reference.nodeId, title: reference.title, category: "canvas", mediaKind: "image" as const, kindLabel: "画布图片", imageUrl: reference.previewUrl, imageStorageKey: reference.storageKey })),
        ...assets.filter((asset) => asset.kind === "image").map((asset) => ({ id: `asset:${asset.id}`, title: asset.title, category: "library", mediaKind: "image" as const, kindLabel: "素材图片", asset })),
    ];
    const commit = async (role: CanvasVideoFrameRole, source?: CanvasVideoFrameSource) => {
        if (busy) return;
        setBusy(true);
        try {
            await onChange(role, source);
            setPickerRole(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片设置失败");
        } finally {
            setBusy(false);
        }
    };
    const drop = (event: DragEvent<HTMLElement>, role: CanvasVideoFrameRole) => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
        const sourceId = event.dataTransfer.getData("application/x-canvas-image-node-id");
        if (file || sourceId) void commit(role, file || sourceId);
    };
    const slot = (role: CanvasVideoFrameRole, label: string) => {
        const reference = images.find((item) => item.nodeId === frames[role]);
        return (
            <div key={role} className="relative shrink-0" data-video-frame-role={role} data-frame-node-id={frames[role]}>
                <button
                    type="button"
                    className="relative flex size-20 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
                    style={{ background: theme.toolbar.itemHover, borderColor: theme.toolbar.border, color: theme.node.muted, outlineColor: theme.node.activeStroke }}
                    aria-label={`${reference ? "更换" : "添加"}${label}图片`}
                    title={reference ? `${label}：${reference.title}，点击更换` : `添加${label}图片，支持拖入图片`}
                    disabled={busy}
                    onClick={() => setPickerRole(role)}
                    onDragOver={(event) => {
                        if (!busy && (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("application/x-canvas-image-node-id"))) {
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "copy";
                        }
                    }}
                    onDrop={(event) => drop(event, role)}
                >
                    {reference ? <CachedResourceImage eager storageKey={reference.storageKey} src={reference.previewUrl} alt={`${label}：${reference.title}`} className="size-full object-contain" fallback={<ImagePlus className="size-5" />} /> : <>
                        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                        <span className="text-[var(--fs-tiny)]">{frames[role] ? "图片不可用" : label}</span>
                        {role === "last" && !frames.last ? <span className="text-[var(--fs-micro)] opacity-65">可选</span> : null}
                    </>}
                    {reference ? <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-[var(--fs-tiny)] text-white">{label}</span> : null}
                </button>
                {frames[role] ? <button type="button" className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border disabled:opacity-50" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} aria-label={`清空${label}图片`} title={`清空${label}图片`} disabled={busy} onClick={() => void commit(role)}><X className="size-3" /></button> : null}
            </div>
        );
    };
    return <>
        <div role="group" aria-label={endFrameSupported ? "首尾帧图片" : "首帧图片"} className="flex items-center gap-2 px-2 py-1" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
            {slot("first", "首帧")}
            {endFrameSupported ? <>
                <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md disabled:opacity-30" style={{ color: theme.node.muted }} aria-label="交换首尾帧" title="交换首尾帧" disabled={busy || !frames.first || !frames.last || !images.some((item) => item.nodeId === frames.first) || !images.some((item) => item.nodeId === frames.last)} onClick={() => onMetadataChange({ videoStartFrameNodeId: frames.last, videoEndFrameNodeId: frames.first })}><ArrowLeftRight className="size-3.5" /></button>
                {slot("last", "尾帧")}
            </> : null}
        </div>
        {pickerRole ? <AssetLibraryPickerModal
            open
            title={`选择${pickerRole === "first" ? "首帧" : "尾帧"}图片`}
            items={items}
            mediaKinds={["image"]}
            categoryLabels={{ all: "全部图片", canvas: "画布图片", library: "素材库" }}
            initialSelectedIds={frames[pickerRole] ? [frames[pickerRole]!] : []}
            multiple={false}
            confirmLabel={() => "使用这张图片"}
            emptyDescription="可以上传本地图片，也可以选择画布或素材库中的图片。"
            upload={{ accept: "image/*", description: "上传图片", onUpload: async (files) => { const file = files.item(0); if (file) await commit(pickerRole, file); return []; } }}
            onConfirm={async (ids) => {
                const item = items.find((candidate) => candidate.id === ids[0]);
                if (!item) return;
                if (item.asset?.kind === "image") await commit(pickerRole, item.asset);
                else await commit(pickerRole, item.id);
            }}
            onClose={() => setPickerRole(null)}
        /> : null}
    </>;
}
