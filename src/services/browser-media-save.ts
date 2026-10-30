import { saveAs } from "file-saver";
import { sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";

export type OwnedMediaSaveResult = "saved" | "cancelled";

export async function downloadOwnedOrBrowserMedia(options: { fileName: string; resourceId?: string; browserUrl?: string }): Promise<OwnedMediaSaveResult> {
    const name = sanitizeDownloadFileName(options.fileName);
    if (options.browserUrl?.trim()) {
        saveAs(options.browserUrl, name);
        return "saved";
    }
    if (!options.resourceId?.trim()) throw new Error("没有可导出的文件");
    const blob = await getResourceBlob(resourceStorageKey(options.resourceId));
    if (!blob) throw new Error("无法读取要导出的文件");
    saveAs(blob, name);
    return "saved";
}

export async function saveOwnedOrBrowserBlob(fileName: string, blob: Blob): Promise<OwnedMediaSaveResult> {
    saveAs(blob, sanitizeDownloadFileName(fileName, "未命名导出"));
    return "saved";
}

export const saveOwnedOrBrowserVideoBlob = saveOwnedOrBrowserBlob;

export function reportOwnedMediaSave(message: { error: (text: string) => void }, result: Promise<OwnedMediaSaveResult>) {
    return result.catch((error) => {
        message.error(error instanceof Error && error.message.trim() ? error.message : "保存没有完成，请再试一次");
    });
}
