import { useState } from "react";
import { Check, LocateFixed } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import { CanvasMediaVersionPreview } from "./canvas-media-version-preview";
import { CanvasMediaLightbox, CanvasMediaPreviewFrame, CanvasPreviewButton, CanvasPreviewToolbar } from "./media-preview";

export type CanvasVersionCompareModalProps = {
    open: boolean;
    versions: CanvasNodeData[];
    onClose: () => void;
    onSetPrimary: (nodeId: string) => boolean;
    onFocus: (nodeId: string) => void;
};

/** 历史业务适配层；通用预览组件不接收版本元数据或恢复回调。 */
export function CanvasVersionCompareModal({ open, versions, onClose, onSetPrimary, onFocus }: CanvasVersionCompareModalProps) {
    const hasArchivedVersions = versions.some((node) => Boolean(node.metadata?.versionStackOwnerId));
    const familyId = versions[0]?.metadata?.versionOfNodeId || versions[0]?.metadata?.versionStackOwnerId || versions[0]?.id;
    return (
        <CanvasMediaLightbox open={open} title={hasArchivedVersions ? "历史结果" : "版本对比"} onClose={onClose}>
            <VersionBrowser key={familyId} versions={versions} hasArchivedVersions={hasArchivedVersions} onClose={onClose} onSetPrimary={onSetPrimary} onFocus={onFocus} />
        </CanvasMediaLightbox>
    );
}

function VersionBrowser({ versions, hasArchivedVersions, onClose, onSetPrimary, onFocus }: Omit<CanvasVersionCompareModalProps, "open"> & { hasArchivedVersions: boolean }) {
    const current = versions.find((node) => node.metadata?.versionPrimary) || (hasArchivedVersions ? versions.find((node) => !node.metadata?.versionStackOwnerId) : undefined);
    const [selectedId, setSelectedId] = useState(() => current?.id || versions[0]?.id);
    // 恢复后快照会被当前结果去重隐藏，回到稳定的当前节点，不保留失效选中项。
    const selected = versions.find((node) => node.id === selectedId) || current || versions[0];
    const selectedIndex = selected ? versions.findIndex((node) => node.id === selected.id) : -1;
    const selectedIsCurrent = Boolean(selected && current?.id === selected.id);
    const currentLabel = hasArchivedVersions ? "当前结果" : "主版本";
    const previous = versions[selectedIndex - 1];
    const next = versions[selectedIndex + 1];

    if (!selected) return <div className="pointer-events-none flex justify-center pt-10">
        <CanvasPreviewToolbar label="历史版本操作">
            <span className="px-2 text-[var(--fs-label)]">暂无版本</span>
            <CanvasPreviewButton label="关闭预览" onClick={onClose}>关闭</CanvasPreviewButton>
        </CanvasPreviewToolbar>
    </div>;

    return <CanvasMediaPreviewFrame
        width={selected.metadata?.naturalWidth || selected.width}
        height={selected.metadata?.naturalHeight || selected.height}
        label="选中版本预览"
        onClose={onClose}
        onPrevious={previous ? () => setSelectedId(previous.id) : undefined}
        onNext={next ? () => setSelectedId(next.id) : undefined}
        toolbar={<CanvasPreviewToolbar label="历史版本操作">
            <span className="px-1 text-[var(--fs-label)]" style={{ lineHeight: "20px" }} title={selected.title}>版本 {selected.metadata?.versionLabel || selectedIndex + 1}</span>
            <span className="pr-1 text-[var(--fs-label)] tabular-nums opacity-60" style={{ lineHeight: "20px" }} aria-label={"第 " + (selectedIndex + 1) + " 个，共 " + versions.length + " 个版本"} aria-live="polite">{selectedIndex + 1} / {versions.length}</span>
            <span aria-hidden className="aceternity-dock-separator mx-1 h-4 w-px shrink-0" />
            <CanvasPreviewButton label="定位到画布" icon={<LocateFixed className="size-3.5" />} onClick={() => onFocus(selected.metadata?.versionStackOwnerId || selected.id)} />
            <CanvasPreviewButton label={selectedIsCurrent ? currentLabel : "使用此版本"} disabled={selectedIsCurrent} icon={selectedIsCurrent ? <Check className="size-3.5" /> : undefined} onClick={() => { if (!selectedIsCurrent && onSetPrimary(selected.id)) onClose(); }}>{selectedIsCurrent ? currentLabel : "使用此版本"}</CanvasPreviewButton>
        </CanvasPreviewToolbar>}
    >
        <CanvasMediaVersionPreview key={selected.id} node={selected} />
    </CanvasMediaPreviewFrame>;
}
