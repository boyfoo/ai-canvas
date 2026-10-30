import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
const files = walk(src);
const source = files.filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith(".d.ts"));
const sourceSet = new Set(source);
const graph = new Map();
const missing = [];
const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", "/index.ts", "/index.tsx", "/index.js"];

function resolveImport(from, specifier) {
    const clean = specifier.split("?")[0];
    if (!clean.startsWith(".") && !clean.startsWith("@/")) return;
    const base = clean.startsWith("@/") ? resolve(src, clean.slice(2)) : resolve(dirname(from), clean);
    for (const extension of extensions) if (existsSync(base + extension) && !readdirIsDirectory(base + extension)) return resolve(base + extension);
    missing.push({ from: relative(root, from), specifier });
}

function readdirIsDirectory(path) {
    try { readdirSync(path); return true; } catch { return false; }
}

function visit(node, imports) {
    if (!node || typeof node !== "object") return;
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ImportExpression") && node.source?.type === "StringLiteral") imports.push(node.source.value);
    if (node.type === "CallExpression" && (node.callee?.type === "Import" || node.callee?.name === "require") && node.arguments?.[0]?.type === "StringLiteral") imports.push(node.arguments[0].value);
    if (node.type === "NewExpression" && node.callee?.name === "URL" && node.arguments?.[0]?.type === "StringLiteral" && /\.worker\./.test(node.arguments[0].value)) imports.push(node.arguments[0].value);
    for (const [key, value] of Object.entries(node)) {
        if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => visit(child, imports));
        else if (value && typeof value === "object") visit(value, imports);
    }
}

for (const file of source) {
    const imports = [];
    const plugins = ["typescript", ...(extname(file).endsWith("x") ? ["jsx"] : [])];
    visit(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins }), imports);
    graph.set(file, imports.map(specifier => resolveImport(file, specifier)).filter(Boolean));
}

// Preserve the full canvas feature surface, including helpers useful for extension.
const roots = source.filter(file => ["pages/canvas/", "components/canvas/", "lib/canvas/", "stores/canvas/", "types/"].some(prefix => relative(src, file).replaceAll("\\", "/").startsWith(prefix)));
roots.push(resolve(src, "main.tsx"));
const reachable = new Set();
function follow(file) { if (reachable.has(file)) return; reachable.add(file); for (const child of graph.get(file) || []) if (sourceSet.has(child)) follow(child); }
roots.forEach(follow);
const report = {
    sourceFiles: source.length,
    roots: roots.map(file => relative(root, file).replaceAll("\\", "/")),
    retained: [...reachable].map(file => relative(root, file).replaceAll("\\", "/")).sort(),
    unreachable: source.filter(file => !reachable.has(file)).map(file => relative(root, file).replaceAll("\\", "/")).sort(),
    missing: missing.filter(item => reachable.has(resolve(root, item.from))),
};
mkdirSync(resolve(root, ".local"), { recursive: true });
writeFileSync(resolve(root, ".local/module-graph.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceFiles: report.sourceFiles, retained: report.retained.length, unreachable: report.unreachable.length, missing: report.missing }, null, 2));
