"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Crown, ExternalLink, Mail, Loader2, Save, ArrowRight } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ExchangesBadge } from "@/components/ui/exchanges-badge";
import { useOutreachCounts } from "@/lib/hooks/use-outreach-counts";
import { saveList } from "@/lib/hooks/use-enrichment";
import type { WatchProspect } from "@/app/api/watchlist/accounts/[id]/prospects/route";
import type { EnrichmentProfile } from "@/lib/intel-types";
import { ProspectGmailModal } from "@/app/watchlist/_components/prospect-gmail-modal";

export function RadarProspectsCard({
  companyName,
  owner,
  prospects,
  isLoading,
}: {
  companyName: string;
  owner: string | null;
  prospects: WatchProspect[];
  isLoading: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [gmailFor, setGmailFor] = React.useState<{ name: string; email: string } | null>(null);
  const [savingList, setSavingList] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const emails = React.useMemo(
    () => prospects.map((p) => p.email).filter((e): e is string => !!e),
    [prospects],
  );
  const hubspotIds = React.useMemo(
    () => prospects.map((p) => p.hubspot_id).filter((id): id is string => !!id),
    [prospects],
  );
  const { countByEmail, countByHubspotId } = useOutreachCounts(emails, hubspotIds);

  const champions = React.useMemo(() => prospects.filter((p) => p.is_champion), [prospects]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === prospects.length) setSelected(new Set());
    else setSelected(new Set(prospects.map((p) => p.id)));
  }

  async function onSaveList() {
    const ids = Array.from(selected);
    const targets = prospects.filter((p) => ids.includes(p.id));
    if (targets.length === 0) return;
    const name = window.prompt(
      "Nom de la liste ?",
      `${companyName} — ${targets.length} prospect${targets.length > 1 ? "s" : ""}`,
    );
    if (!name) return;
    setSavingList(true);
    setFeedback(null);
    try {
      const results: EnrichmentProfile[] = targets.map(toEnrichmentProfile);
      await saveList({
        name,
        source: "netrows",
        criteria: { source: "watchlist", company: companyName, owner: owner ?? null } as unknown as never,
        results,
      });
      setFeedback({ kind: "ok", msg: `Liste "${name}" créée (${results.length} profils).` });
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur création liste" });
    } finally {
      setSavingList(false);
    }
  }

  function onExportMassProspection() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const params = new URLSearchParams({ from: "watchlist", ids: ids.join(",") });
    router.push(`/mass-prospection?${params.toString()}`);
  }

  return (
    <>
      <section
        style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: 520,
        }}
      >
        <header
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
            🎯 Radar ({prospects.length})
          </span>
          {champions.length > 0 && (
            <span
              title="Champions actifs"
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#fef3c7",
                color: "#92400e",
                fontWeight: 600,
              }}
            >
              ★ {champions.length} champion{champions.length > 1 ? "s" : ""}
            </span>
          )}
          {prospects.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              style={{
                marginLeft: "auto",
                fontSize: 10,
                color: COLORS.ink2,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {selected.size === prospects.length ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          )}
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {isLoading && prospects.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : prospects.length === 0 ? (
            <p style={{ fontSize: 11, color: COLORS.ink3, textAlign: "center", padding: 16 }}>
              Aucun prospect au radar pour ce compte. Ajoute des profils LinkedIn depuis Enrichissement.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {prospects.map((p) => {
                const isSel = selected.has(p.id);
                const exchangeCount =
                  (p.email ? countByEmail(p.email) : 0) ||
                  (p.hubspot_id ? countByHubspotId(p.hubspot_id) : 0);
                return (
                  <li
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      border: `1px solid ${isSel ? COLORS.brand : COLORS.line}`,
                      background: isSel ? `${COLORS.brand}11` : COLORS.bgCard,
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: "pointer" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                          {p.full_name ?? p.username ?? "?"}
                        </span>
                        {p.is_champion && (
                          <span title="Champion" style={{ color: "#92400e", display: "inline-flex" }}>
                            <Crown size={11} />
                          </span>
                        )}
                        {p.profile_url && (
                          <a
                            href={p.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "#0a66c2", display: "inline-flex" }}
                            title="LinkedIn"
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                        <ExchangesBadge count={exchangeCount} />
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: COLORS.ink3,
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.headline ?? "—"}
                      </div>
                    </div>
                    {p.email && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGmailFor({ name: p.full_name ?? p.username ?? p.email!, email: p.email! });
                        }}
                        title="Historique Gmail"
                        style={{
                          border: "none",
                          background: "transparent",
                          color: COLORS.ink2,
                          cursor: "pointer",
                          padding: 4,
                          display: "inline-flex",
                        }}
                      >
                        <Mail size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer
          style={{
            padding: "10px 12px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {feedback && (
            <span style={{ fontSize: 10, color: feedback.kind === "ok" ? COLORS.ok : COLORS.err }}>
              {feedback.msg}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={onSaveList}
              disabled={selected.size === 0 || savingList}
              style={btnSecondary(selected.size === 0 || savingList)}
            >
              <Save size={11} /> {savingList ? "…" : `Liste (${selected.size})`}
            </button>
            <button
              type="button"
              onClick={onExportMassProspection}
              disabled={selected.size === 0}
              style={btnPrimary(selected.size === 0)}
            >
              <ArrowRight size={11} /> Mass Prospection
            </button>
          </div>
        </footer>
      </section>

      {gmailFor && (
        <ProspectGmailModal
          fullName={gmailFor.name}
          email={gmailFor.email}
          onClose={() => setGmailFor(null)}
        />
      )}
    </>
  );
}

function toEnrichmentProfile(p: WatchProspect): EnrichmentProfile {
  const [firstName, ...rest] = (p.full_name ?? "").split(" ");
  return {
    username: p.username ?? "",
    fullName: p.full_name ?? p.username ?? "",
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    headline: p.headline ?? undefined,
    company: p.company ?? undefined,
    profileUrl: p.profile_url ?? undefined,
    email: p.email ?? undefined,
    hubspotId: p.hubspot_id ?? undefined,
    source: (p.source ?? "manual") as EnrichmentProfile["source"],
    selected: true,
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 8px",
    fontSize: 11,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
