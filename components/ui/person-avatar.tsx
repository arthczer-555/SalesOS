import * as React from "react";
import { companyAvatarGradient } from "@/lib/design/tokens";

// Avatar initiales d'une personne (dégradé stable dérivé du nom).
export function PersonAvatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const clean = (name ?? "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  const g = companyAvatarGradient(clean || "?");
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        display: "inline-grid",
        placeItems: "center",
        background: g.background,
        color: g.color,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </span>
  );
}
