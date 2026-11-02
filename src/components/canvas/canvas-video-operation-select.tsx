import { Select } from "antd";
import { ChevronDown } from "lucide-react";
import { providerVideoOperations, resolveVideoOperation } from "@/lib/generation-operations";
import type { AiConfig } from "@/stores/use-config-store";
import type { ModelInputSummary } from "@/lib/model-selection";

type ModeOption = { value: string; label: string; description: string; disabled?: boolean; reason?: string };

/** 复用 Select 的键盘、焦点和选择逻辑；紧凑触发器沿用模型按钮外观，选项保留完整说明。 */
export function CanvasVideoOperationSelect({ config, input, value, onChange, compact = false }: { config: AiConfig; input: ModelInputSummary; value?: string; onChange: (value: string) => void; compact?: boolean }) {
    const modes = providerVideoOperations(config, input);
    if (!modes?.length) return null;
    const selectedValue = resolveVideoOperation(input, value, config);
    const selected = modes.find((mode) => mode.value === selectedValue);
    const options: ModeOption[] = [
        ...modes.map((mode) => ({ value: mode.value, label: mode.label, description: mode.help || "", reason: mode.inputIssue })),
        ...(selectedValue && !selected ? [{ value: selectedValue, label: "请重新选择模式", description: "当前模型不支持此模式，请重新选择。", disabled: true }] : []),
    ];
    const displayLabel = selected?.label || "请选择模式";
    return (
        <div className={compact ? "min-w-0 max-w-full shrink-0" : "min-w-0 w-full"} title={`${displayLabel}${selected?.help ? `：${selected.help}` : ""}`}>
            <Select<string, ModeOption>
                aria-label="视频生成模式"
                size={compact ? "small" : "middle"}
                variant={compact ? "borderless" : "outlined"}
                className={compact ? "canvas-composer-model-picker !h-auto !min-h-7 !gap-1.5 !border-0 !px-2.5 !py-1 !text-[var(--fs-tiny)] !font-normal !shadow-none hover:!bg-surface-hover [&.ant-select-open]:!bg-surface-hover" : "w-full"}
                value={selectedValue || undefined}
                options={options}
                virtual={false}
                listHeight={360}
                popupMatchSelectWidth={false}
                placement="bottomLeft"
                suffixIcon={<ChevronDown aria-hidden="true" className="size-3 shrink-0" />}
                classNames={{ popup: { root: "canvas-h3-option-popup" } }}
                styles={{
                    root: {
                        width: compact ? "max-content" : "100%", maxWidth: "100%", alignItems: "center",
                        ...(compact ? { borderRadius: 9, background: "color-mix(in srgb, var(--workspace-surface-strong) 94%, var(--workspace-accent) 6%)", color: "var(--foreground)" } : {}),
                    },
                    content: { justifyContent: "center", alignItems: "center", marginInlineEnd: compact ? 0 : 4, overflow: "visible" },
                    suffix: { color: "color-mix(in srgb, var(--foreground) 52%, transparent)" },
                    popup: { root: { width: "min(440px, calc(100vw - 24px))" }, listItem: { whiteSpace: "normal", height: "auto" } },
                }}
                labelRender={() => <span className="flex min-w-0 w-full items-center justify-center whitespace-normal text-center leading-5 [overflow-wrap:anywhere]">{displayLabel}</span>}
                optionRender={({ data }) => (
                    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-1">
                        <span className="whitespace-normal text-center text-xs font-medium leading-5">{data.label}</span>
                        <span className="whitespace-normal text-xs leading-5 text-foreground/60 [overflow-wrap:anywhere]">{data.description}</span>
                        {data.reason ? <span className="col-start-2 whitespace-normal text-xs leading-5 text-foreground/50">{data.reason}</span> : null}
                    </div>
                )}
                onChange={onChange}
            />
        </div>
    );
}
