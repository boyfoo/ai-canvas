import { AudioLines, Image as ImageIcon, Video } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import { canvasNodeVideoPreviewUrl } from "@/lib/canvas/canvas-media-preview";
import { buildLibTVVideoSourceUrl } from "@/lib/canvas/libtv-import";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type VersionPreviewProps = { node: CanvasNodeData; fit?: "contain" | "cover" };

/** 叠卡与历史面板共用被动预览；仅显示已有图片或视频首帧，不播放或准备转码。 */
export function CanvasMediaVersionPreview({ node, fit = "contain" }: VersionPreviewProps) {
    const mediaClass = `pointer-events-none block size-full ${fit === "cover" ? "object-cover" : "object-contain"}`;
    const placeholder = <VersionPreviewPlaceholder node={node} />;
    if (node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey)) {
        return <div className="size-full [&>.cached-resource-image-shell]:block [&>.cached-resource-image-shell]:size-full"><CachedResourceImage storageKey={node.metadata.storageKey} src={node.metadata.content} alt={node.title || "历史图片"} className={mediaClass} loading="lazy" decoding="async" draggable={false} fallback={placeholder} loadingFallback={placeholder} /></div>;
    }
    const poster = canvasNodeVideoPreviewUrl(node);
    if (poster) {
        return <div className="size-full [&>.cached-resource-image-shell]:block [&>.cached-resource-image-shell]:size-full"><CachedResourceImage storageKey={node.metadata?.videoPreview?.storageKey} src={poster} alt={node.title || "历史视频"} className={mediaClass} loading="lazy" decoding="async" draggable={false} fallback={placeholder} loadingFallback={placeholder} /></div>;
    }
    if (node.type === CanvasNodeType.Video && (node.metadata?.content || node.metadata?.storageKey)) return <VersionVideoFrame node={node} fit={fit} />;
    return placeholder;
}

function VersionVideoFrame({ node, fit }: Required<VersionPreviewProps>) {
    const content = node.metadata?.content || "";
    const source = node.metadata?.importSource?.provider === "libtv" ? buildLibTVVideoSourceUrl(content) : content;
    const playback = useResourceVideoPlayback(node.metadata?.storageKey || "", source);
    if (!playback.url || playback.error) return <VersionPreviewPlaceholder node={node} />;
    return <video src={playback.url} aria-label={node.title || "历史视频"} muted playsInline preload="metadata" draggable={false} className={`pointer-events-none block size-full ${fit === "cover" ? "object-cover" : "object-contain"}`} onError={playback.fail} onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.001, video.duration / 2);
    }} />;
}

function VersionPreviewPlaceholder({ node }: { node: CanvasNodeData }) {
    const Icon = node.type === CanvasNodeType.Audio ? AudioLines : node.type === CanvasNodeType.Video ? Video : ImageIcon;
    return <span role="img" aria-label={node.title || "历史媒体"} className="grid size-full place-items-center opacity-50"><Icon className="size-8" aria-hidden /></span>;
}
