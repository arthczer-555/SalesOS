"use client";

import * as React from "react";
import useSWR from "swr";
import { Search, Trash2, Star, ExternalLink, Linkedin } from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS } from "@/lib/design/tokens";
import type { RadarProfile } from "@/lib/intel-types";

interface RadarResponse {
  profiles: RadarProfile[];
}

const fetcher = async (url: string): Promise<RadarResponse> => {
  const r = await fetch(url);
  const data = (await r.json().catch(() => null)) as RadarResponse | { error?: string } | null;
  if (!r.ok) {
    const err = (data && "error" in data && data.error) || `HTTP ${r.status}`;
    throw new Error(err);
  }
  return (data ?? { profiles: [] }) as RadarResponse;
};

interface TrackedProfilesListProps {
  /** `champion` → ?is_champion=true ; `all` → tous les Radar actifs. */
  scope: "champion" | "all";
  allowAdd?: boolean;
  allowChampionToggle?: boolean;
  emptyLabel: string;
  helpText: string;
  /** Source à envoyer au POST add-to-radar quand allowAdd=true. */
  addSource?: "manual" | "champion";
  /** Flag is_champion à passer à l'ajout. */
  addAsChampion?: boolean;
}

export function TrackedProfilesList({
  scope,
  allowAdd = false,
  allowChampionToggle = false,
  emptyLabel,
  helpText,
  addSource = "manual",
  addAsChampion = false,
}: TrackedProfilesListProps) {
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [addInput, setAddInput] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (scope === "champion") params.set("is_champion", "true");
  if (debouncedQ) params.set("q", debouncedQ);
  const url = `/api/intel/enrich/radar${params.toString() ? `?${params.toString()}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<RadarResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  const profiles = data?.profiles ?? [];

  async function remove(username: string) {
    if (!window.confirm(`Retirer @${username} du Radar ?`)) return;
    try {
      const r = await fetch(`/api/intel/enrich/radar/${encodeURIComponent(username)}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setFeedback({ kind: "ok", msg: `@${username} retiré.` });
      void mutate();
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    }
  }

  async function toggleChampion(username: string, current: boolean) {
    try {
      const r = await fetch(`/api/intel/enrich/radar/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_champion: !current }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setFeedback({ kind: "ok", msg: `@${username} ${!current ? "marqué champion" : "retiré des champions"}.` });
      void mutate();
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    }
  }

  function parseInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]).replace(/\/$/, "");
    return trimmed.replace(/^@/, "").replace(/\/$/, "");
  }

  async function addManually() {
    const username = parseInput(addInput);
    if (!username) {
      setFeedback({ kind: "err", msg: "Renseigne une URL LinkedIn ou un username." });
      return;
    }
    setAdding(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/intel/enrich/add-to-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: [{ username, source: addSource, is_champion: addAsChampion }],
        }),
      });
      const body = (await r.json().catch(() => null)) as
        | { added?: string[]; skipped?: string[]; failed?: { error: string }[] }
        | { error?: string }
        | null;
      if (!r.ok) {
        const msg = (body && "error" in body && body.error) || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      const added = (body && "added" in body && body.added) || [];
      const skipped = (body && "skipped" in body && body.skipped) || [];
      const failed = (body && "failed" in body && body.failed) || [];
      if (failed.length > 0) {
        setFeedback({ kind: "err", msg: failed[0]?.error ?? "Échec de l'ajout." });
      } else if (added.length > 0) {
        setFeedback({ kind: "ok", msg: `@${added[0]} ajouté.` });
        setAddInput("");
      } else if (skipped.length > 0) {
        setFeedback({ kind: "ok", msg: `@${skipped[0]} était déjà au Radar (mise à jour).` });
        setAddInput("");
      } else {
        setFeedback({ kind: "err", msg: "Aucune action effectuée." });
      }
      void mutate();
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>{helpText}</p>

      <div style={{ position: "relative" }}>
        <Search
          size={13}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrer par nom, headline, entreprise…"
          style={{
            width: "100%",
            paddingLeft: 30,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            fontSize: 12,
            outline: "none",
            background: COLORS.bgCard,
          }}
        />
      </div>

      <div
        style={{
          maxHeight: 360,
          overflowY: "auto",
          border: `1px solid ${COLORS.line}`,
          borderRadius: 8,
          background: COLORS.bgCard,
        }}
      >
        {isLoading ? (
          <p style={cellMsg()}>Chargement…</p>
        ) : error ? (
          <p style={{ ...cellMsg(), color: COLORS.err }}>
            {error instanceof Error ? error.message : "Erreur de chargement."}
          </p>
        ) : profiles.length === 0 ? (
          <p style={cellMsg()}>{emptyLabel}</p>
        ) : (
          profiles.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "8px 12px",
                borderBottom: `1px solid ${COLORS.line}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <CompanyAvatar name={p.full_name ?? p.username} size={28} rounded="full" />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.ink0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.full_name ?? p.username}
                  </span>
                  {p.is_champion && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 99,
                        background: COLORS.warnBg,
                        color: COLORS.warn,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      champion
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: COLORS.ink2,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {p.headline && (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.headline}
                    </span>
                  )}
                  {p.company && <span style={{ color: COLORS.ink3 }}>@ {p.company}</span>}
                  <a
                    href={p.profile_url ?? `https://www.linkedin.com/in/${p.username}/`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0a66c2", fontSize: 11 }}
                  >
                    <Linkedin size={10} />
                    LinkedIn
                    <ExternalLink size={9} />
                  </a>
                </div>
              </div>

              {allowChampionToggle && (
                <button
                  type="button"
                  onClick={() => toggleChampion(p.username, p.is_champion)}
                  title={p.is_champion ? "Retirer du flag champion" : "Marquer comme champion"}
                  aria-label={p.is_champion ? "Retirer champion" : "Marquer champion"}
                  style={iconBtn(p.is_champion)}
                >
                  <Star
                    size={14}
                    fill={p.is_champion ? COLORS.warn : "none"}
                    color={p.is_champion ? COLORS.warn : COLORS.ink3}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(p.username)}
                title="Retirer du Radar"
                aria-label={`Retirer ${p.username}`}
                style={iconBtn(false)}
              >
                <Trash2 size={13} color={COLORS.ink3} />
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ fontSize: 11, color: COLORS.ink3 }}>
        {profiles.length > 0 && `${profiles.length} profil${profiles.length > 1 ? "s" : ""}`}
      </div>

      {allowAdd && (
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="URL LinkedIn ou username (ex: jdoe)"
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${COLORS.line}`,
              outline: "none",
              background: COLORS.bgCard,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !adding) {
                e.preventDefault();
                void addManually();
              }
            }}
          />
          <button
            type="button"
            onClick={addManually}
            disabled={adding || !addInput.trim()}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${COLORS.brand}`,
              background: adding || !addInput.trim() ? COLORS.bgSoft : COLORS.brand,
              color: adding || !addInput.trim() ? COLORS.ink3 : "white",
              cursor: adding || !addInput.trim() ? "not-allowed" : "pointer",
            }}
          >
            {adding ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      )}

      {feedback && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: feedback.kind === "ok" ? COLORS.ok : COLORS.err,
          }}
        >
          {feedback.msg}
        </p>
      )}
    </div>
  );
}

function cellMsg(): React.CSSProperties {
  return {
    padding: "16px 12px",
    fontSize: 12,
    color: COLORS.ink3,
    textAlign: "center",
    margin: 0,
  };
}

function iconBtn(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? COLORS.warn : COLORS.line}`,
    background: active ? COLORS.warnBg : COLORS.bgCard,
    width: 26,
    height: 26,
    borderRadius: 6,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  };
}
