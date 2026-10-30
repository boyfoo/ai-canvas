const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    projectDetail: () => import("@/pages/projects/detail"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;

export function preloadWorkspaceRoute(pathname: string) {
    const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (segments[0] === "canvas" && segments[1]) return void loadCanvasProjectPage();
    if (segments[0] === "projects" && segments[1]) return void loadProjectDetailPage();
    if (segments[0] === "assets") return void loadAssetsPage();
    if (!segments.length || segments[0] === "canvas") void loadCanvasPage();
}
