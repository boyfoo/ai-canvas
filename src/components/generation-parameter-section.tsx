import type { ReactNode } from "react";
import { Tag } from "antd";

export function GenerationParameterSection({
    kind,
    source,
    children,
    collapsible = false,
}: {
    kind: "common" | "extension";
    source?: string;
    children: ReactNode;
    collapsible?: boolean;
}) {
    const extension = kind === "extension";
    const title = extension ? `扩展参数${source ? ` · ${source}` : ""}` : "通用参数";
    const heading = (
        <span className="inline-flex flex-wrap items-center gap-2">
            <Tag className="!m-0" color={extension ? "purple" : "blue"}>
                {extension ? "扩展" : "通用"}
            </Tag>
            <span className="text-xs font-semibold">{title}</span>
        </span>
    );
    const content = (
        <div className="mt-3 space-y-3">
            <p className="text-xs leading-5 text-foreground/50">
                {extension ? "由此提供商或模型系列扩展，仅在对应模型中生效。" : "同类模型共用的设置项，仅显示当前模型支持的选项。"}
            </p>
            {children}
        </div>
    );
    const className = "rounded-lg border border-[var(--workspace-border)] p-3";
    return collapsible ? (
        <details className={className}>
            <summary className="cursor-pointer" aria-label={title}>
                {heading}
            </summary>
            {content}
        </details>
    ) : (
        <section className={className} aria-label={title}>
            {heading}
            {content}
        </section>
    );
}
