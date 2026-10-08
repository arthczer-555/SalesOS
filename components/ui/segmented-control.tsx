import * as React from "react";

type IconType = React.ComponentType<{ size?: number | string }>;

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; icon?: IconType; disabled?: boolean; title?: string };

// Choix exclusif compact (ex. "New thread | Reply in thread").
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  fullWidth,
  style,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`ds-segmented ${size === "sm" ? "ds-segmented-sm" : ""}`.trim()}
      role="group"
      style={{ ...(fullWidth ? { display: "flex", width: "100%" } : null), ...style }}
    >
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            className="ds-segmented-item"
            aria-pressed={o.value === value}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            style={fullWidth ? { flex: 1 } : undefined}
          >
            {Icon ? <Icon size={size === "sm" ? 12 : 13} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
