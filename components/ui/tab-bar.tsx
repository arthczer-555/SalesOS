import * as React from "react";

type IconType = React.ComponentType<{ size?: number | string; className?: string }>;

export type TabItem = {
  key: string;
  label: React.ReactNode;
  icon?: IconType;
  badge?: React.ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  // "alert" (rouge) / "warn" (ambre) : onglet qui demande une action. Le libellé
  // passe dans une pilule teintée, avec `count` en pastille pleine.
  tone?: "alert" | "warn";
  count?: React.ReactNode;
};

export function TabBar({
  tabs,
  active,
  onChange,
  className = "",
  style,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`ds-tab-bar ${className}`.trim()} style={style} role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          const toneClass = t.tone ? `ds-tab-${t.tone}` : "";
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              disabled={t.disabled}
              onClick={() => onChange(t.key)}
              className={`ds-tab ${isActive ? "ds-tab-active" : ""} ${toneClass}`.trim()}
              style={t.disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              {Icon ? <Icon size={14} /> : null}
              {t.tone ? (
                <span className="ds-tab-tone">
                  {t.label}
                  {t.count != null ? <span className="ds-tab-count">{t.count}</span> : null}
                </span>
              ) : (
                <span>{t.label}</span>
              )}
              {t.badge ? <span style={{ marginLeft: 4 }}>{t.badge}</span> : null}
            </button>
          );
        })}
    </div>
  );
}
