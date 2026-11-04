import { useEffect, useState } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasMediaVersionPreview } from "./canvas-media-version-preview";

/** 仅背卡持续悬停 1 秒后向上扇开；主框悬停不参与，点击仍打开原历史列表。 */
export function CanvasMediaVersionStack({ count, previews = [], interactive, theme, onOpen }: { count: number; previews?: CanvasNodeData[]; interactive: boolean; theme: CanvasTheme; onOpen: () => void }) {
    const [backHovered, setBackHovered] = useState(false);
    const [hoverDelayElapsed, setHoverDelayElapsed] = useState(false);
    useEffect(() => {
        setHoverDelayElapsed(false);
        if (!interactive) setBackHovered(false);
        if (!backHovered || !interactive) return;
        const timer = window.setTimeout(() => setHoverDelayElapsed(true), 1000);
        // 移出、开始连线/拖动或卸载时取消，短暂掠过不展开，重新移入重新计时。
        return () => window.clearTimeout(timer);
    }, [backHovered, interactive]);
    const expanded = backHovered && interactive && hoverDelayElapsed;
    if (count <= 0) return null;
    const visiblePreviews = previews.slice(0, 3);
    const compactOffset = visiblePreviews.length * 10;
    return <>
        {/* 命中区固定覆盖紧凑叠卡，只有内部画面移动，避免移入背卡时因卡片移走反复开合。
            连线期间整体禁用命中，防止主框外背卡被识别为连接目标。 */}
        {visiblePreviews.length > 0 ? <button
            type="button"
            className="absolute left-0 top-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-4"
            style={{ right: -compactOffset, bottom: -compactOffset, zIndex: -2, pointerEvents: interactive ? "auto" : "none", outlineColor: theme.accent.primary }}
            aria-label={`查看 ${count} 个历史结果`}
            aria-haspopup="dialog"
            data-history-expanded={expanded ? "true" : "false"}
            onMouseEnter={() => { setHoverDelayElapsed(false); setBackHovered(true); }}
            onMouseLeave={() => { setBackHovered(false); setHoverDelayElapsed(false); }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); setBackHovered(false); setHoverDelayElapsed(false); onOpen(); }}
        >
            {visiblePreviews.map((node, index) => <span
                key={node.id}
                aria-hidden
                className="absolute left-0 top-0 block overflow-hidden rounded-[var(--node-radius)] border motion-reduce:transition-none"
                style={{ right: compactOffset, bottom: compactOffset, transform: expanded ? `translate(${34 + index * 18}px, ${-24 - index * 18}px) rotate(${-6 - index * 4}deg)` : `translate(${(index + 1) * 10}px, ${(index + 1) * 10}px)`, transformOrigin: "bottom left", zIndex: -index, background: theme.node.fill, borderColor: theme.node.stroke, boxShadow: theme.node.shadow, transitionProperty: "transform", transitionDuration: "calc(220ms * var(--motion-scale, 1))", transitionTimingFunction: "var(--motion-ease-out)" }}
            >
                <CanvasMediaVersionPreview node={node} fit="cover" />
                <span data-canvas-live-scale className="absolute right-3 top-3 grid min-h-6 min-w-6 place-items-center rounded-md border px-1.5" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, fontSize: "var(--fs-label)", fontWeight: 500, transform: "scale(var(--canvas-live-inverse-scale, 1))", transformOrigin: "top right" }}>{node.metadata?.versionLabel || index + 1}</span>
            </span>)}
        </button> : null}
        {/* 独立底板遮住透明主图下的旧图片，不盖住向外露出的历史画面。 */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-1 rounded-[var(--node-radius)]" style={{ background: theme.node.fill }} />
    </>;
}
