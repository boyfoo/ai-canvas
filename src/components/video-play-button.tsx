import { Play } from "lucide-react";

/** 静态预览与播放器暂停状态共用，集中维护中央播放按钮的外观与事件隔离。 */
export function VideoPlayButton({ title, onPlay }: { title: string; onPlay: () => void }) {
    return (
        <button
            type="button"
            className="pointer-events-auto absolute left-1/2 top-1/2 z-[var(--node-z-overlay)] grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/82 bg-white/94 !text-[#171b21] shadow-[0_3px_14px_rgba(0,0,0,0.34)] transition-[scale,background-color,box-shadow] duration-150 hover:scale-105 hover:bg-white hover:shadow-[0_4px_18px_rgba(0,0,0,0.44)] active:scale-98 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] motion-reduce:transition-none"
            data-video-player-control
            aria-label={`播放 ${title}`}
            title="播放视频"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onPlay();
            }}
        >
            <Play className="size-5 fill-current" strokeWidth={1.5} aria-hidden />
        </button>
    );
}
