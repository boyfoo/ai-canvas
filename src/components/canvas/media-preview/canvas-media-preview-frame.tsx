import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { CanvasPreviewButton } from "./canvas-preview-button";

export type CanvasMediaPreviewFrameProps = {
    width: number;
    height: number;
    onClose: () => void;
    children: ReactNode;
    label?: string;
    onPrevious?: () => void;
    onNext?: () => void;
    toolbar?: ReactNode;
};

/**
 * 按源比例展示媒体，安排外悬关闭、左右切换及工具条，消费 node-radius token。
 * 不读取画布节点、加载资源、播放媒体或改变选择；内容由调用方提供。
 * 缺少相邻项回调时禁用对应按钮，不在布局组件里推断版本或页码。
 */
export function CanvasMediaPreviewFrame({ width, height, onClose, children, label = "媒体预览", onPrevious, onNext, toolbar }: CanvasMediaPreviewFrameProps) {
    const ratio = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 1;
    const mediaWidth = Math.min(420, 300 * ratio);

    return <div data-slot="canvas-media-preview-frame" className="pointer-events-none flex flex-col items-center gap-4 pt-10">
        <section className="grid max-w-full grid-cols-[36px_auto_36px] items-center gap-3" aria-label={label}>
            <CanvasPreviewButton label="上一项" floating icon={<ChevronLeft className="size-5" />} disabled={!onPrevious} onClick={onPrevious} />
            <div className="relative min-w-0">
                <CanvasPreviewButton label="关闭预览" title="关闭" floating icon={<X className="size-4" />} style={{ position: "absolute", top: -40, right: 0 }} onClick={onClose} />
                <div className="pointer-events-auto overflow-hidden rounded-[var(--r-lg)]" style={{ width: `min(${mediaWidth}px, calc(100vw - 128px), calc((100dvh - 152px) * ${ratio}))`, aspectRatio: ratio }}>
                    {children}
                </div>
            </div>
            <CanvasPreviewButton label="下一项" floating icon={<ChevronRight className="size-5" />} disabled={!onNext} onClick={onNext} />
        </section>
        {toolbar}
    </div>;
}
