import { createBrowserRouter, type RouteObject } from "react-router";

export type AppRoutingLocation = Partial<Pick<Location, "protocol" | "hostname" | "host" | "pathname" | "search" | "hash" | "href" | "origin">>;
export type AppRoutingRuntime = { location: AppRoutingLocation };

export function defaultAppRoutingRuntime(): AppRoutingRuntime {
    return { location: typeof window === "undefined" ? { origin: "http://localhost", pathname: "/" } : window.location };
}

export function createWorkspaceRouter(routes: RouteObject[]) {
    return createBrowserRouter(routes);
}

export function appPathname(runtime = defaultAppRoutingRuntime()) {
    const path = runtime.location.pathname || "/";
    return path === "/index.html" ? "/" : path;
}

export function appSearch(runtime = defaultAppRoutingRuntime()) {
    return runtime.location.search || "";
}

export function appHref(path: string, runtime = defaultAppRoutingRuntime()) {
    const base = runtime.location.origin || "http://localhost";
    return new URL(path.startsWith("/") ? path : `/${path}`, base).href;
}

export function appPathnameFrom(value: string | undefined, runtime = defaultAppRoutingRuntime()) {
    if (!value?.trim()) return appPathname(runtime);
    // Existing shared canvas links may contain an old hash path.
    const raw = value.trim().replace(/^#/, "");
    try {
        const url = new URL(raw, runtime.location.origin || "http://localhost");
        return url.hash.startsWith("#/") ? new URL(url.hash.slice(1), url.origin).pathname : url.pathname;
    } catch {
        return raw.split(/[?#]/u, 1)[0] || "/";
    }
}
