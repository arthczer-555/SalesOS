"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useToast } from "@/components/ui/toast";
import { CLIENT_TIERS, toClientTier, type ClientTier } from "@/lib/clients/tier";
import { TAG_TONES, type TagTone } from "../[id]/_components/ui";
import { saveTier } from "./tier-api";

// Sélecteur du tier d'un compte, en pastille : colonne Tier des deux vues de
// /clients et header de la fiche. <select> natif plutôt qu'un DropdownMenu :
// son menu, rendu dans la cellule, serait coupé par l'overflow des tableaux.
// Pas d'orange/rouge (réservés aux signaux) : Tier 1 plein, Tier 2 teinté,
// Tier 3 neutre, non classé en pointillés.

export const TIER_HINT = "Account importance, set by the team. Tier 1 = strategic, top priority. Tier 2 = important. Tier 3 = standard.";

const TIER_TONE: Record<ClientTier, TagTone> = { 1: "solid", 2: "brand", 3: "neutral" };

const SIZES = {
  sm: { fontSize: 11, padding: "2px 22px 2px 8px", chevronRight: 7 },
  md: { fontSize: 12, padding: "3px 24px 3px 10px", chevronRight: 8 },
} as const;

export function TierSelect({
  clientId,
  tier,
  onSaved,
  size = "sm",
  title,
}: {
  clientId: string;
  tier: ClientTier | null;
  onSaved: (tier: ClientTier | null) => void;
  size?: keyof typeof SIZES;
  title?: string;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const tone = tier ? TAG_TONES[TIER_TONE[tier]] : null;
  const s = SIZES[size];
  const fg = tone ? tone.fg : COLORS.ink3;

  async function change(value: string) {
    const next = toClientTier(value);
    if (next === tier) return;
    setSaving(true);
    try {
      await saveTier(clientId, next);
      onSaved(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save the tier", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    // La ligne de la vue simple est un <Link> et celle de la vue avancée a un
    // onRowClick : choisir un tier ne doit ni naviguer ni ouvrir la fiche.
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <select
        value={tier ?? ""}
        disabled={saving}
        onChange={(e) => void change(e.target.value)}
        aria-label="Account tier"
        title={title ?? TIER_HINT}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          fontFamily: "inherit",
          fontSize: s.fontSize,
          fontWeight: 600,
          lineHeight: 1.5,
          padding: s.padding,
          borderRadius: 999,
          background: tone ? tone.bg : "transparent",
          color: fg,
          border: tone ? `1px solid ${tone.border}` : `1px dashed ${COLORS.lineStrong}`,
          cursor: saving ? "wait" : "pointer",
          opacity: saving ? 0.6 : 1,
          outline: "none",
          whiteSpace: "nowrap",
        }}
      >
        <option value="" style={{ color: COLORS.ink0, background: COLORS.bgCard }}>
          {tier ? "No tier" : "Set tier"}
        </option>
        {CLIENT_TIERS.map((n) => (
          <option key={n} value={n} style={{ color: COLORS.ink0, background: COLORS.bgCard }}>
            Tier {n}
          </option>
        ))}
      </select>
      {saving ? (
        <Loader2 size={11} className="animate-spin" style={{ position: "absolute", right: s.chevronRight, pointerEvents: "none", color: fg }} />
      ) : (
        <ChevronDown size={11} style={{ position: "absolute", right: s.chevronRight, pointerEvents: "none", color: fg }} />
      )}
    </span>
  );
}
