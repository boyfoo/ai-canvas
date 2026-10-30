import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const output = resolve(root, ".local/browser-smoke");
mkdirSync(output, { recursive: true });
const apiCalls = [], modelCalls = [], errors = [], checks = [];
async function readBrowserRecord(page, key) {
    return page.evaluate(async key => {
        const database = await new Promise((resolve, reject) => { const request = indexedDB.open("infinite-canvas"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { return await new Promise((resolve, reject) => { const request = database.transaction("app_state").objectStore("app_state").get(key); request.onsuccess = () => resolve(request.result ? JSON.parse(request.result) : null); request.onerror = () => reject(request.error); }); }
        finally { database.close(); }
    }, key);
}
async function waitForSavedCanvas(page, predicate) {
    const deadline = Date.now() + 15_000;
    while (true) {
        const record = await readBrowserRecord(page, "infinite-canvas:canvas_store:user:local");
        if (record?.state.projects.some(predicate)) return;
        assert.ok(Date.now() < deadline, "canvas edits must be saved in IndexedDB");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webp": "image/webp" };

// Only serves static build files. No workspace API fixtures or backend.
const server = createServer(async (request, response) => {
    try {
        const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (path.startsWith("/api/")) {
            apiCalls.push(`${request.method} ${path}`);
            response.writeHead(503); response.end("No backend in standalone smoke test"); return;
        }
        let file = resolve(dist, `.${path}`);
        if (relative(dist, file).startsWith("..")) { response.writeHead(403); response.end(); return; }
        if (!await stat(file).then(value => value.isFile()).catch(() => false)) {
            if (/\.[a-z0-9]+$/i.test(path)) { response.writeHead(404); response.end(); return; }
            file = resolve(dist, "index.html");
        }
        response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
        response.end(await readFile(file));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
});

// A separate CORS model service verifies the browser actually requests its URL.
// Uses synthetic credentials; no real model or paid requests.
const models = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    modelCalls.push({ method: request.method, path: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "smoke-text", supported_endpoint_types: ["chat.completions"] }] }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await new Promise(resolve => models.listen(0, "127.0.0.1", resolve));
const modelOrigin = `http://127.0.0.1:${models.address().port}`;
let browser, page;
try {
    browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30_000 });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/canvas`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "开始创作", exact: true }).click();
    await page.locator("#canvas-main").waitFor({ timeout: 30_000 });
    const canvasURL = page.url();
    checks.push("static build opens and creates a canvas without a backend");

    await page.locator("#canvas-main").dblclick({ position: { x: 600, y: 300 } });
    await page.getByText("文本", { exact: true }).click();
    await page.getByRole("button", { name: "编辑节点名称：文本节点 1", exact: true }).click();
    await page.getByRole("textbox", { name: "节点名称", exact: true }).fill("独立运行测试节点");
    await page.getByRole("textbox", { name: "节点名称", exact: true }).press("Enter");
    await page.getByRole("button", { name: "编辑节点名称：独立运行测试节点", exact: true }).waitFor();
    const node = page.locator("[data-node-id]");
    const nodeId = await node.getAttribute("data-node-id");
    const before = await node.boundingBox();
    const handle = await page.getByLabel("拖动节点：独立运行测试节点", { exact: true }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2 + 70, { steps: 15 });
    await page.mouse.up();
    const after = await node.boundingBox();
    assert.ok(Math.abs(after.x - before.x) > 40, "node dragging must move the node");
    checks.push("text nodes can be created, renamed and dragged");
    await waitForSavedCanvas(page, project => project.nodes.some(node => node.title === "独立运行测试节点"));
    await page.reload();
    await page.getByRole("button", { name: "编辑节点名称：独立运行测试节点", exact: true }).waitFor();
    assert.equal(await page.locator(`[data-node-id="${nodeId}"]`).count(), 1);
    checks.push("edited canvas is restored from IndexedDB after reload");

    await page.locator("#canvas-main").dblclick({ position: { x: 1000, y: 650 } });
    await page.getByText("上传", { exact: true }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "local-pixel.png", mimeType: "image/png", buffer: await readFile(resolve(root, "src/assets/app-icon.png")) });
    await page.getByRole("button", { name: "添加到画布（1）", exact: true }).click();
    await waitForSavedCanvas(page, project => project.nodes.some(node => node.type === "image" && node.metadata?.storageKey && !node.metadata?.fileUpload));
    await page.reload();
    await page.locator("[data-node-id]").nth(1).waitFor();
    checks.push("local image imports and survives reload without a resource server");
    await page.screenshot({ path: resolve(output, "canvas.png") });

    await page.goto(`${origin}/settings?section=channels`);
    await page.locator(".settings-page").waitFor();
    await page.getByRole("button", { name: "添加模型服务", exact: true }).first().click();
    await page.getByRole("textbox", { name: "连接名称", exact: true }).fill("浏览器直连测试");
    await page.getByLabel("API Key", { exact: true }).fill("synthetic-test-key");
    await page.getByRole("textbox", { name: "服务地址", exact: true }).fill(`${modelOrigin}/v1`);
    await page.getByRole("button", { name: "读取模型", exact: true }).click();
    await page.getByText("smoke-text", { exact: true }).waitFor();
    assert.equal(modelCalls.at(-1)?.path, "/v1/models");
    assert.equal(modelCalls.at(-1)?.authorization, "Bearer synthetic-test-key");
    assert.equal(modelCalls.at(-1)?.cookie, undefined);
    checks.push("model catalogue is fetched directly from a separate CORS model service");

    await page.locator(".model-service-model").filter({ hasText: "smoke-text" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "保存并使用", exact: true }).click();
    await page.getByText("连接你的模型服务", { exact: true }).waitFor({ state: "hidden" });
    await page.reload();
    await page.locator(".settings-channel").filter({ hasText: "浏览器直连测试" }).waitFor();
    const modelConfig = await readBrowserRecord(page, "infinite-canvas:model_config:user:local");
    assert.ok(modelConfig.config.channels.some(channel => channel.name === "浏览器直连测试" && channel.apiKey === "synthetic-test-key"), "model credentials must survive a reload in browser storage");
    checks.push("model channel and credentials survive reload using browser persistence");

    await page.screenshot({ path: resolve(output, "settings.png") });

    await page.goto(`${origin}/canvas`);
    await page.getByRole("checkbox", { name: "选择 未命名项目", exact: true }).check();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const download = await downloadPromise;
    const backup = resolve(output, "canvas-backup.zip");
    await download.saveAs(backup);
    assert.ok((await stat(backup)).size > 0);
    checks.push("canvas and its local media export as a ZIP backup without a backend");
    assert.deepEqual(apiCalls, [], "standalone canvas must not request workspace APIs");
    assert.deepEqual(errors, [], "browser must not report runtime errors");
    console.log(JSON.stringify({ passed: true, checks, apiCalls }, null, 2));
} catch (error) { errors.push(error.message); if (page) { console.log("FAILED_PAGE", (await page.locator("body").innerText()).slice(0,3000)); await page.screenshot({path:resolve(output,"failure.png")}); } throw error; }
finally {
    writeFileSync(resolve(output, "result.json"), JSON.stringify({ passed: !errors.length, backend: false, realModelCalls: false, checks, errors, apiCalls }, null, 2) + "\n");
    await browser?.close();
    server.closeAllConnections(); models.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => models.close(resolve))]);
}
