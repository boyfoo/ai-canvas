import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { bootstrapCanvasHost } from "@/services/canvas-host";

export async function startApplication() {
    bootstrapCanvasHost();
    await bootstrapAppearance().catch(() => console.warn("外观初始化未完成，继续打开工作区"));
    await import("./application");
}
