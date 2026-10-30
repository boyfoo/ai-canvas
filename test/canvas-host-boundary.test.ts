import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
const read = (name: string) => readFileSync(resolve(root, name), "utf8");

describe("standalone canvas extraction", () => {
    it("has no executable Wails bridge or desktop updater in source", () => {
        const files = walk(resolve(root, "src")).filter(file => /\.[jt]sx?$/.test(file));
        for (const file of files) {
            expect(readFileSync(file, "utf8")).not.toMatch(/window\.go\b|getDesktopAppBinding|registerDesktopUpdatePreparation|bootstrapDesktopRuntime|services\/desktop-/);
        }
    });

    it("keeps supporting canvas routes but excludes unrelated portals", () => {
        const router = read("src/router.tsx");
        for (const route of ["/canvas/:id", "/settings", "/skills", "/assets", "/plugins", "/projects/:projectId/:view"]) expect(router).toContain(`"${route}"`);
        expect(router).not.toMatch(/pages\/(home|create|agents|dev)|test-voice-recording/);
    });

    it("keeps worker, model and style resources inside this project", () => {
        for (const path of ["src/contracts/image_contracts.json", "src/contracts/video_contracts.json", "src/assets/app-icon.png", "public/canvas", "public/mediapipe", "public/three", "public/lighting-presets", "public/short-drama-styles"]) expect(existsSync(resolve(root, path))).toBe(true);
        expect(read("vite.config.ts")).not.toContain("../scripts/");
        expect(read("vite.config.ts")).not.toContain("build:slim");
    });
});
