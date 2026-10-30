import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
const entries = [];
for (const file of walk(resolve(root, "src")).filter(path => /\.[jt]sx?$/.test(path))) {
    const source = readFileSync(file, "utf8");
    function visit(node) {
        if (!node || typeof node !== "object") return;
        let method;
        if (node.type === "CallExpression" && node.callee?.type === "MemberExpression" && node.callee.object?.name === "http") method = node.callee.property?.name?.toUpperCase();
        if (node.type === "CallExpression" && node.callee?.name === "fetch") method = "FETCH";
        if (node.type === "NewExpression" && node.callee?.name === "EventSource") method = "SSE";
        if (method && node.arguments?.[0]) {
            const arg = node.arguments[0];
            const endpoint = arg.type === "StringLiteral" ? arg.value : source.slice(arg.start, arg.end);
            entries.push({ method, endpoint, file: relative(root, file).replaceAll("\\", "/"), line: node.loc.start.line });
        }
        for (const [key, value] of Object.entries(node)) {
            if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue;
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
        }
    }
    visit(parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }));
}
mkdirSync(resolve(root, "docs"), { recursive: true });
writeFileSync(resolve(root, "docs/api-call-inventory.json"), JSON.stringify({ note: "Static call sites, not a complete server specification. RAW/FETCH and dynamic expressions require manual review.", entries }, null, 2) + "\n");
console.log(JSON.stringify({ callSites: entries.length, output: "docs/api-call-inventory.json" }));
