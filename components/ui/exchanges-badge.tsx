import * as React from "react";
import { Mail } from "lucide-react";

interface Props {
  count: number;
  size?: "xs" | "sm";
  title?: string;
}

/**
 * Badge "X échanges" affiché à côté d'un contact pour indiquer combien
 * d'emails CoachelloHQ lui ont déjà été envoyés. Masqué si count = 0.
 */
export function ExchangesBadge({ count, size = "xs", title }: Props) {
  if (count <= 0) return null;
  const fontSize = size === "xs" ? 9 : 10;
  const padding = size === "xs" ? "1px 5px" : "2px 6px";
  const iconSize = size === "xs" ? 9 : 10;
  return (
    <span
      title={title ?? `${count} email${count > 1 ? "s" : ""} sent from CoachelloHQ`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding,
        borderRadius: 99,
        background: "#fff8fb",
        color: "#f01563",
        border: "1px solid #fbd5e3",
        fontSize,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <Mail size={iconSize} />
      {count} exchange{count > 1 ? "s" : ""}
    </span>
  );
}
