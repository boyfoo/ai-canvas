import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { createWorkspaceRouter } from "@/lib/app-routing";
import { WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { loadAssetsPage, loadCanvasPage, loadCanvasProjectPage, loadProjectDetailPage } from "@/lib/workspace-route-modules";
import CanvasLayout from "@/layouts/canvas-layout";
import RouteErrorPage from "@/pages/route-error";

const CanvasPage = lazy(loadCanvasPage);
const CanvasProjectPage = lazy(loadCanvasProjectPage);
const AssetsPage = lazy(loadAssetsPage);
const ProjectDetailPage = lazy(loadProjectDetailPage);
const SettingsPage = lazy(() => import("@/pages/settings"));
const SkillsPage = lazy(() => import("@/pages/skills/marketplace"));
const PluginsPage = lazy(() => import("@/pages/plugins"));
const EaglePage = lazy(() => import("@/pages/plugins/eagle"));
const NotFound = lazy(() => import("@/pages/not-found"));

function deferred(element: ReactNode) {
    return <Suspense fallback={<WorkspaceRouteLoader />}>{element}</Suspense>;
}

function ProjectAlias() {
    const { projectId, "*": rest } = useParams();
    return <Navigate to={`/projects/${projectId}${rest ? `/${rest}` : ""}`} replace />;
}

export const router = createWorkspaceRouter([{
    element: <CanvasLayout />,
    errorElement: <RouteErrorPage />,
    children: [
        { path: "/", element: <Navigate to="/canvas" replace /> },
        { path: "/canvas", element: deferred(<CanvasPage />) },
        { path: "/canvas/:id", element: deferred(<CanvasProjectPage />) },
        { path: "/project", element: <Navigate to="/canvas" replace /> },
        { path: "/projects", element: <Navigate to="/canvas" replace /> },
        { path: "/project/:projectId/*", element: <ProjectAlias /> },
        // The canvas links to project style, chapter and canvas-list views.
        { path: "/projects/:projectId", element: deferred(<ProjectDetailPage />) },
        { path: "/projects/:projectId/:view", element: deferred(<ProjectDetailPage />) },
        { path: "/projects/:projectId/chapters/:chapterId", element: deferred(<ProjectDetailPage />) },
        { path: "/projects/:projectId/workflow/:unitId/:stage", element: deferred(<ProjectDetailPage />) },
        { path: "/settings", element: deferred(<SettingsPage />) },
        { path: "/skills", element: deferred(<SkillsPage />) },
        { path: "/skill", element: <Navigate to="/skills" replace /> },
        { path: "/assets", element: deferred(<AssetsPage />) },
        { path: "/plugins", element: deferred(<PluginsPage />) },
        { path: "/plugins/eagle", element: deferred(<EaglePage />) },
        { path: "*", element: deferred(<NotFound />) },
    ],
}]);
