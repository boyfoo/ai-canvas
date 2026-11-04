import { cloneElement, useState, type CSSProperties, type HTMLAttributes, type ReactElement } from "react";

import { VideoPlayer, isVideoPlayerControlEvent } from "@/components/video-player";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { inferVideoHasAudio } from "@/lib/canvas/canvas-media-preview";
import { canvasThemes } from "@/lib/canvas-theme";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasImagePreview } from "./canvas-image-preview";
import { VideoPlayButton } from "@/components/video-play-button";

type CanvasReferencePreviewProps = {
    reference: CanvasResourceReference;
    onClose: () => void;
};

export function canPreviewCanvasReference(reference: CanvasResourceReference) {
    if (reference.kind === "video" && (referenceVideoSource(reference) || referenceVideoStorageKey(reference))) return true;
    return ["image", "character", "video", "audio"].includes(reference.kind) && Boolean(reference.previewUrl?.trim());
}

/** 素材栏和提示词内引用共用预览入口；文字内容不能作为图片地址。 */
export function CanvasReferencePreview({ reference, onClose }: CanvasReferencePreviewProps) {
    if (reference.kind === "video" && (referenceVideoSource(reference) || referenceVideoStorageKey(reference))) {
        return <ReferenceVideoFramePreview key={JSON.stringify([reference.id, referenceVideoStorageKey(reference), referenceVideoSource(reference)])} reference={reference} onClose={onClose} />;
    }
    if (!canPreviewCanvasReference(reference) || !reference.previewUrl) return null;
    return <CanvasImagePreview src={reference.previewUrl} alt={reference.title || reference.label} onClose={onClose} />;
}

export function referenceVideoSource(reference: CanvasResourceReference) {
    if (reference.kind !== "video") return "";
    const url = reference.mediaUrl || reference.videoPreviewSource?.metadata?.content || "";
    // 服务商 asset:// 不是浏览器可加载的视频地址，不能把它当作原生媒体链接。
    return /^(https?:\/\/|blob:|data:)/i.test(url) ? url : "";
}

export function referenceVideoStorageKey(reference: CanvasResourceReference) {
    return reference.kind === "video" ? reference.storageKey || reference.videoPreviewSource?.metadata?.storageKey || "" : "";
}

// 仅用于图片预览组件的布局与手势测量，不是视频截图，也不写入素材或任务结果。
const FRAME_PREVIEW_LAYOUT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

/** 图片预览外壳保留；播放入口与实际播放器都复用画布视频节点，不另做控件样式。 */
function ReferenceVideoFramePreview({ reference, onClose }: { reference: CanvasResourceReference; onClose: () => void }) {
    const storageKey = referenceVideoStorageKey(reference);
    const playback = useResourceVideoPlayback(storageKey, referenceVideoSource(reference));
    const theme = canvasThemes[useActiveTheme()];
    const [active, setActive] = useState(false);
    // 初始值仅为加载时的显示尺寸；解码后按真实比例显示，与本地 400px 封面一致。
    const [frameSize, setFrameSize] = useState({ width: 400, height: 225 });
    const updateFrameSize = (sourceWidth: number, sourceHeight: number) => {
        if (sourceWidth <= 0 || sourceHeight <= 0) return;
        const width = Math.min(400, sourceWidth);
        const height = width * sourceHeight / sourceWidth;
        setFrameSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    const onPlaybackError = () => { if (!playback.requestCompatible()) playback.fail(); };
    return <CanvasImagePreview src={reference.previewUrl || FRAME_PREVIEW_LAYOUT} alt={reference.title || reference.label} onClose={onClose} imageRender={(originalNode) => {
        const original = originalNode as ReactElement<HTMLAttributes<HTMLElement>>;
        const frameStyle: CSSProperties = {
            ...original.props.style,
            width: `min(${frameSize.width}px, 100vw, ${70 * frameSize.width / frameSize.height}vh)`,
            height: `min(${frameSize.height}px, ${100 * frameSize.height / frameSize.width}vw, 70vh)`,
            maxWidth: "none", maxHeight: "none",
        };
        const overlayStyle: CSSProperties = { ...frameStyle, position: "absolute", inset: 0, margin: "auto", pointerEvents: "none" };
        // 播放时仅转发画面手势；进度、音量等控件保留播放器自己的事件处理。
        // 不包定位容器，保持原图片相对预览视口的 offsetParent，避免缩放中心计算偏移。
        return <>
            {/* 保留原节点及其 ref/事件，让图片组件负责所有缩放、旋转、翻转和拖动。 */}
            {cloneElement(original, { style: { ...frameStyle, opacity: 0 } })}
            {playback.url && !playback.error ? active ? (
                <div className={original.props.className} style={{ ...overlayStyle, pointerEvents: "auto" }}
                    onLoadedMetadataCapture={(event) => { if (event.target instanceof HTMLVideoElement) updateFrameSize(event.target.videoWidth, event.target.videoHeight); }}
                    onErrorCapture={(event) => { if (event.target instanceof HTMLSourceElement) onPlaybackError(); }}
                    onMouseDown={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onMouseDown?.(event); }}
                    onWheel={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onWheel?.(event); }}
                    onDoubleClick={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onDoubleClick?.(event); }}
                    onTouchStart={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onTouchStart?.(event); }}
                    onTouchMove={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onTouchMove?.(event); }}
                    onTouchEnd={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onTouchEnd?.(event); }}
                    onTouchCancel={(event) => { if (!isVideoPlayerControlEvent(event)) original.props.onTouchCancel?.(event); }}
                >
                    <VideoPlayer src={playback.url} mimeType={playback.compatible ? "video/mp4" : reference.videoPreviewSource?.metadata?.mimeType} title={reference.title || reference.label} hasAudio={inferVideoHasAudio(reference.videoPreviewSource?.metadata)} brandColor={theme.accent.primary} autoPlay compactControls dataCanvasNoZoom className="size-full bg-black" onError={onPlaybackError} />
                </div>
            ) : reference.previewUrl ? (
                <img src={reference.previewUrl} alt="" className={original.props.className} style={overlayStyle} onLoad={(event) => updateFrameSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
            ) : (
                <video src={playback.url} aria-hidden muted playsInline preload="metadata" draggable={false} className={original.props.className} style={overlayStyle} onError={onPlaybackError} onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    updateFrameSize(video.videoWidth, video.videoHeight);
                    if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.001, video.duration / 2);
                }} />
            ) : <span role="status" style={overlayStyle} className="grid place-items-center text-sm leading-normal text-white">{playback.error ? "视频预览暂不可用" : "正在加载首帧"}</span>}
            {!active && playback.url && !playback.error ? <VideoPlayButton title={reference.title || reference.label} onPlay={() => setActive(true)} /> : null}
        </>;
    }} />;
}
