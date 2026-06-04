"use client";

import { useState } from "react";
import { ListChecks, Loader2, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { mergeOnboardingItems, type ClientRow, type OnboardingItem } from "@/lib/clients/types";

// "Client onboarding" card (left column). Fully manual checklist: base template
// items grouped by category/section, ticked by the team. Items are ticked in
// place (strikethrough). The card disappears once everything is checked, or when
// the CSM dismisses it (e.g. long-onboarded accounts / not needed).
export function OnboardingChecklistPanel({ client, onUpdated }: { client: ClientRow; onUpdated: () => void }) {
  // Etat optimiste : la case bascule instantanement (override local par key),
  // le PATCH part en arriere-plan. Sans ca, la case attend le refetch complet
  // du client (qui refait un appel HubSpot live cote GET) -> delai visible.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Masquee par le CSM pour ce compte.
  if (client.onboarding_checklist?.dismissed) return null;

  // La checklist depend du coaching type du programme (champ de donnees, pas
  // l'item de checklist). "humain" et "hybride" affichent la checklist humaine
  // ("hybride" ajoute en plus un onglet "AI Coaching" a venir) ; "ia" est a venir ;
  // null = pas encore renseigne (la checklist en depend).
  const coachingType = client.fields_json?.program_scope?.type_coaching?.value ?? null;
  if (!coachingType) {
    return <OnboardingInfoCard message="Set the program's coaching type to load the onboarding checklist." />;
  }
  if (coachingType === "ia") {
    return <OnboardingInfoCard message="Coming soon. The AI onboarding checklist is on the way." />;
  }
  const isHybrid = coachingType === "hybride";

  const items = mergeOnboardingItems(client.onboarding_checklist ?? null).map((i) =>
    i.key in overrides ? { ...i, done: overrides[i.key] } : i,
  );
  const pending = items.filter((i) => !i.done);

  // Everything checked: the card has done its job.
  if (items.length > 0 && pending.length === 0) return null;

  // Group by category (level 1) then section (level 2), preserving template order.
  const categories: Array<{ name: string; sections: Array<{ name: string; items: OnboardingItem[] }> }> = [];
  for (const item of items) {
    let c = categories.find((x) => x.name === item.category);
    if (!c) {
      c = { name: item.category, sections: [] };
      categories.push(c);
    }
    let s = c.sections.find((x) => x.name === item.section);
    if (!s) {
      s = { name: item.section, items: [] };
      c.sections.push(s);
    }
    s.items.push(item);
  }

  async function dismiss() {
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${client.id}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setConfirmDismiss(false);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setDismissing(false);
    }
  }

  function toggle(item: OnboardingItem) {
    const next = !item.done;
    setOverrides((o) => ({ ...o, [item.key]: next })); // bascule instantanee
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${client.id}/onboarding`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: item.key, done: next }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `HTTP ${res.status}`);
        }
        onUpdated(); // resynchronise le reste de la fiche en arriere-plan
      } catch (e) {
        // Echec : on annule l'override pour revenir a l'etat serveur.
        setOverrides((o) => {
          const c = { ...o };
          delete c[item.key];
          return c;
        });
        setError(e instanceof Error ? e.message : "Error");
      }
    })();
  }

  return (
    <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ListChecks size={15} style={{ color: COLORS.brand, flexShrink: 0 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
          Client onboarding · {pending.length} to do
        </h3>
        <button
          type="button"
          onClick={() => setConfirmDismiss(true)}
          title="Remove this checklist for this account"
          aria-label="Remove onboarding checklist"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: COLORS.ink3,
            cursor: "pointer",
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
        {error && <div style={{ fontSize: 12, color: COLORS.err }}>{error}</div>}

        {categories.map((category) => {
          const total = category.sections.reduce((n, s) => n + s.items.length, 0);
          const left = category.sections.reduce((n, s) => n + s.items.filter((i) => !i.done).length, 0);
          return (
            <div key={category.name} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${COLORS.line}`,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.brand, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {category.name}
                </span>
                <span style={{ fontSize: 11, color: COLORS.ink3, marginLeft: "auto" }}>
                  {total - left}/{total}
                </span>
              </div>
              {category.sections.map((section) => (
                <div key={section.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: COLORS.ink3,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {section.name}
                  </div>
                  {section.items.map((item) => (
                    <label
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 9,
                        cursor: "pointer",
                        fontSize: 13,
                        color: item.done ? COLORS.ink3 : COLORS.ink0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => toggle(item)}
                        style={{ marginTop: 2, width: 15, height: 15, accentColor: COLORS.brand, cursor: "pointer", flexShrink: 0 }}
                      />
                      <span style={{ lineHeight: 1.4, textDecoration: item.done ? "line-through" : "none" }}>{item.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        {/* Hybride : la checklist humaine + un 3e onglet "AI Coaching" a venir. */}
        {isHybrid && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${COLORS.line}`,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.brand, textTransform: "uppercase", letterSpacing: 0.5 }}>
                AI Coaching
              </span>
              <span style={{ fontSize: 11, color: COLORS.ink3, marginLeft: "auto" }}>Coming soon</span>
            </div>
            <div style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 1.5 }}>
              The AI coaching onboarding checklist is on the way.
            </div>
          </div>
        )}
      </div>

      {confirmDismiss && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
            padding: 20,
          }}
          onClick={() => !dismissing && setConfirmDismiss(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              border: `1px solid ${COLORS.line}`,
              maxWidth: 420,
              width: "100%",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Remove onboarding checklist?</h4>
            <p style={{ margin: 0, fontSize: 13, color: COLORS.ink1, lineHeight: 1.5 }}>
              This hides the onboarding checklist for this account (e.g. already onboarded long ago, or not needed). You
              can bring it back anytime from the header (<strong style={{ fontWeight: 600 }}>Show onboarding</strong>).
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmDismiss(false)}
                disabled={dismissing}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: "white",
                  color: COLORS.ink2,
                  cursor: dismissing ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void dismiss()}
                disabled={dismissing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: dismissing ? COLORS.bgSoft : COLORS.brand,
                  color: dismissing ? COLORS.ink3 : "#fff",
                  cursor: dismissing ? "not-allowed" : "pointer",
                }}
              >
                {dismissing && <Loader2 size={13} className="animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Card simple (meme chrome que la checklist, sans dismiss) : utilisee quand il n'y
// a pas de checklist a afficher (coaching type non renseigne, ou IA/Hybrid a venir).
function OnboardingInfoCard({ message }: { message: string }) {
  return (
    <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ListChecks size={15} style={{ color: COLORS.brand, flexShrink: 0 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>Client onboarding</h3>
      </div>
      <div style={{ padding: 14, fontSize: 13, color: COLORS.ink2, lineHeight: 1.5 }}>{message}</div>
    </div>
  );
}
