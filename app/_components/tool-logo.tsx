"use client";

/**
 * Vrais logos des outils connectés (favicons officiels 64px stockés dans
 * public/tool-logos/, pas de hotlink). Utilisés dans la timeline de réflexion,
 * le panneau Sources et la rangée d'outils de l'accueil.
 */

import * as React from "react";
import Image from "next/image";
import { Globe, BookOpen } from "lucide-react";

export type LogoKey =
  | "hubspot" | "slack" | "claap" | "notion" | "gmail" | "drive"
  | "linkedin" | "sheets" | "web" | "guide" | "coachello";

const LOGO_SRC: Partial<Record<LogoKey, string>> = {
  hubspot: "/tool-logos/hubspot.png",
  slack: "/tool-logos/slack.png",
  claap: "/tool-logos/claap.png",
  notion: "/tool-logos/notion.png",
  gmail: "/tool-logos/gmail.svg",
  drive: "/tool-logos/drive.svg",
  linkedin: "/tool-logos/linkedin.png",
  sheets: "/tool-logos/sheets.svg",
  coachello: "/logo.png",
};

/** Nom d'outil de l'agent -> logo. Aligné sur lib/chat/tools/registry.ts. */
export function logoKeyForTool(toolName: string): LogoKey {
  if (toolName === "load_guide") return "guide";
  if (toolName.startsWith("notion_")) return "notion";
  if (toolName.includes("slack")) return "slack";
  if (toolName.includes("gmail")) return "gmail";
  if (toolName.includes("claap")) return "claap";
  if (toolName.includes("linkedin")) return "linkedin";
  if (toolName.includes("drive")) return "drive";
  if (toolName === "get_billing_revenue") return "sheets";
  if (toolName === "search_clients" || toolName === "get_client") return "coachello";
  if (toolName === "web_search") return "web";
  return "hubspot"; // search_contacts, search_deals, get_deals, get_deal_*, get_companies...
}

/** Kind d'une source (chat_jobs.sources) -> logo. */
export function logoKeyForSourceKind(kind: string): LogoKey {
  switch (kind) {
    case "notion": return "notion";
    case "claap": return "claap";
    case "drive": return "drive";
    case "gmail": return "gmail";
    case "billing": return "sheets";
    case "client": return "coachello";
    case "guide": return "guide";
    default: return "web";
  }
}

export function ToolLogo({ logo, size = 16 }: { logo: LogoKey; size?: number }) {
  if (logo === "web") return <Globe size={size} style={{ color: "#8f857c", flexShrink: 0 }} />;
  if (logo === "guide") return <BookOpen size={size} style={{ color: "#f01563", flexShrink: 0 }} />;
  const src = LOGO_SRC[logo];
  if (!src) return <Globe size={size} style={{ color: "#8f857c", flexShrink: 0 }} />;
  return (
    <Image
      src={src}
      alt={logo}
      width={size}
      height={size}
      style={{ borderRadius: 3, flexShrink: 0, objectFit: "contain" }}
      unoptimized
    />
  );
}
