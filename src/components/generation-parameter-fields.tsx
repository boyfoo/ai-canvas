import { Input, InputNumber, Select, Switch } from "antd";
import { useId, type ReactNode } from "react";
import type { GenerationParameterField } from "@/lib/generation-parameter-types";
import type { GenerationParameterInput } from "@/lib/generation-parameter-types";
import { configuredGenerationParameters, patchProviderParameter } from "@/lib/generation-parameters";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { Switch as CanvasSwitch } from "@/components/ui/base/switch";

export function GenerationParameterFields({
    fields,
    value,
    onChange,
    stringValues = false,
    disabled = false,
}: {
    fields: GenerationParameterField[];
    value: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    stringValues?: boolean;
    disabled?: boolean;
}) {
    const instanceId = useId();
    const patch = (field: GenerationParameterField, input: string | number | boolean | undefined) => {
        const next = { ...value };
        const raw = field.write ? field.write(input) : input;
        if (raw === undefined || raw === "" || raw === null) delete next[field.key];
        else next[field.key] = stringValues ? String(raw) : raw;
        onChange(next);
    };
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields
                .filter((field) => !field.hidden)
                .map((field) => {
                    const raw = field.forcedValue ?? value[field.key] ?? field.recommended;
                    const input = field.read ? field.read(raw) : raw;
                    const fieldDisabled = disabled || Boolean(field.disabled);
                    const id = `${instanceId}-${field.key}`;
                    return (
                        <div key={field.key} className="min-w-0 space-y-1.5">
                            <label htmlFor={id} className="block text-xs font-medium">
                                {field.label}
                            </label>
                            {field.type === "boolean" ? (
                                <Switch id={id} aria-label={field.label} disabled={fieldDisabled} checked={input === true || input === "true"} onChange={(checked) => patch(field, checked)} />
                            ) : field.type === "select" ? (
                                <Select
                                    id={id}
                                    aria-label={field.label}
                                    className="w-full"
                                    classNames={{ popup: { root: "generation-parameter-popup" } }}
                                    disabled={fieldDisabled}
                                    allowClear
                                    placeholder="使用推荐值"
                                    value={input === undefined ? undefined : String(input)}
                                    options={field.options}
                                    onChange={(next) => patch(field, next)}
                                />
                            ) : field.type === "number" ? (
                                <>
                                    {field.specialValues?.length ? (
                                        <Select
                                            id={`${id}-mode`}
                                            aria-label={`${field.label}模式`}
                                            className="mb-1.5 w-full"
                                            disabled={fieldDisabled}
                                            value={field.specialValues.some((item) => item.value === Number(input)) ? Number(input) : "manual"}
                                            options={[...field.specialValues, { value: "manual", label: "指定数值" }]}
                                            onChange={(next) => patch(field, next === "manual" ? field.min : Number(next))}
                                        />
                                    ) : null}
                                    {!field.specialValues?.some((item) => item.value === Number(input)) ? (
                                        <InputNumber
                                            id={id}
                                            aria-label={field.label}
                                            className="!w-full"
                                            disabled={fieldDisabled}
                                            min={field.min}
                                            max={field.max}
                                            step={field.step}
                                            value={input === undefined ? null : Number(input)}
                                            placeholder="使用推荐值"
                                            onChange={(next) => patch(field, next ?? undefined)}
                                        />
                                    ) : null}
                                </>
                            ) : (
                                <Input
                                    id={id}
                                    aria-label={field.label}
                                    disabled={fieldDisabled}
                                    value={input === undefined ? "" : String(input)}
                                    maxLength={field.maxLength}
                                    placeholder="使用服务默认值"
                                    onChange={(event) => patch(field, event.target.value)}
                                />
                            )}
                            {field.help || field.disabled ? <p className="text-xs leading-5 text-foreground/50">{field.disabled || field.help}</p> : null}
                        </div>
                    );
                })}
        </div>
    );
}

/** 画布只渲染参数，不包含任何具体提供商判断；沿用视频面板的按钮、开关和输入样式。 */
export function CanvasProviderParameterFields({ config, theme, input, onChange }: { config: AiConfig; theme: CanvasTheme; input?: GenerationParameterInput; onChange: (value: NonNullable<AiConfig["providerOptions"]>) => void }) {
    const instanceId = useId();
    const parameters = configuredGenerationParameters(config, input);
    if (!parameters?.profile.protocol) return null;
    const { channel, profile, values, extensions } = parameters;
    const fields = extensions.filter((field) => !field.hidden);
    if (!fields.length) return null;
    const patch = (field: GenerationParameterField, value: string | number | boolean | undefined) => {
        const raw = field.write ? field.write(value) : value;
        const next = patchProviderParameter(channel, profile, values, field.key, raw, parameters.input);
        onChange({ ...config.providerOptions, [profile.protocol!]: next });
    };
    return (
        <details className="mt-3 space-y-3" style={{ color: theme.node.text }}>
            <summary className="cursor-pointer text-[length:var(--fs-label)] font-semibold" style={{ color: theme.node.muted }}>
                更多参数
            </summary>
            {fields.map((field) => {
                const raw = field.forcedValue ?? values[field.key] ?? field.recommended;
                const value = field.read ? field.read(raw) : raw;
                const id = `${instanceId}-${field.key}`;
                const disabled = Boolean(field.disabled);
                return (
                    <CanvasParameterGroup key={field.key} title={field.label} color={theme.node.muted}>
                        {field.type === "boolean" ? (
                            <div className="rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                                <CanvasParameterSwitch label={field.label} checked={value === true} theme={theme} disabled={disabled} onChange={(checked) => patch(field, checked)} />
                            </div>
                        ) : field.type === "select" ? (
                            <div className="grid grid-cols-2 gap-1.5">
                                {field.options?.map((option) => (
                                    <CanvasParameterOption key={option.value} selected={String(value) === option.value} disabled={disabled} theme={theme} onClick={() => patch(field, option.value)}>
                                        {option.label}
                                    </CanvasParameterOption>
                                ))}
                                {!disabled && values[field.key] !== undefined ? (
                                    <CanvasParameterOption selected={false} theme={theme} onClick={() => patch(field, undefined)}>
                                        使用默认值
                                    </CanvasParameterOption>
                                ) : null}
                            </div>
                        ) : (
                            <input
                                id={id}
                                aria-label={field.label}
                                type={field.type === "number" ? "number" : "text"}
                                disabled={disabled}
                                min={field.min}
                                max={field.max}
                                step={field.step}
                                maxLength={field.maxLength}
                                className="h-8 w-full min-w-0 rounded-md border px-2 !text-[length:var(--fs-caption)] outline-none disabled:opacity-35"
                                style={{ background: theme.toolbar.itemHover, borderColor: theme.toolbar.border, color: theme.node.text }}
                                value={value === undefined ? "" : String(value)}
                                placeholder="使用服务默认值"
                                onChange={(event) => patch(field, event.target.value === "" ? undefined : field.type === "number" ? Number(event.target.value) : event.target.value)}
                            />
                        )}
                        {field.help || field.disabled ? (
                            <p className="text-[length:var(--fs-label)] leading-relaxed" style={{ color: theme.node.muted }}>
                                {field.disabled || field.help}
                            </p>
                        ) : null}
                    </CanvasParameterGroup>
                );
            })}
        </details>
    );
}

// 通用参数和扩展参数复用相同样式；字号须标为 length，原生控件用 ! 覆盖 AntD 的层外 reset。
export function CanvasParameterOption({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className="h-8 cursor-pointer whitespace-nowrap rounded-md px-1 !text-[length:var(--fs-caption)] font-medium leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function CanvasParameterGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-[length:var(--fs-label)] font-semibold" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

export function CanvasParameterSwitch({ label, checked, theme, disabled, onChange }: { label: string; checked: boolean; theme: CanvasTheme; disabled?: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-2">
            <span className="min-w-0 whitespace-nowrap text-[length:var(--fs-caption)]" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                <CanvasSwitch size="sm" checked={checked} disabled={disabled} onChange={onChange} />
            </span>
        </div>
    );
}
