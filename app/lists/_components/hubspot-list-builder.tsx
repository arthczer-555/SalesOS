"use client";

import * as React from "react";
import {
  ExternalLink,
  Trophy,
  XCircle,
  Activity,
  Mail,
  Linkedin,
  CheckSquare,
  Square,
  Plus,
  Loader2,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentProfile, HubspotCriteria } from "@/lib/intel-types";
import { searchHubspot } from "@/lib/hooks/use-enrichment";
import { HubspotFilters } from "./hubspot-filters";

const LIFECYCLE_COLORS: Record<string, { fg: string; bg: string }> = {
  customer: { fg: COLORS.ok, bg: COLORS.okBg },
  evangelist: { fg: COLORS.brand, bg: COLORS.brandTint },
  opportunity: { fg: COLORS.info, bg: COLORS.infoBg },
  salesqualifiedlead: { fg: COLORS.warn, bg: COLORS.warnBg },
  marketingqualifiedlead: { fg: "#0891b2", bg: "#cffafe" },
  lead: { fg: COLORS.ink2, bg: COLORS.bgSoft },
  subscriber: { fg: COLORS.ink3, bg: COLORS.bgSoft },
};

const DEFAULT_CRITERIA: HubspotCriteria = { createdRange: "all", sort: "createdate-desc", limit: 50, dealStatus: "any" };

const idOf = (p: EnrichmentProfile) => p.hubspotId ?? p.email ?? p.fullName;

function fmtMoney(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const n = parseFloat(amount);
  if (Number.isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k€`;
  return `${Math.round(n)}€`;
}

/**
 * Constructeur de liste HubSpot en deux colonnes :
 *  - gauche : filtres CONTACT (live)
 *  - droite : la vraie liste de contacts (résultats), cochables, avec "Charger plus".
 *
 * Le panier (`cart`) est une Map id→profil qui PERSISTE quand on change de filtre :
 * on peut cocher des contacts, changer les filtres, en cocher d'autres, puis créer la liste.
 */
export function HubspotListBuilder({
  scopeCompanies = [],
  onCreate,
  isCreating,
}: {
  scopeCompanies?: { id: string; name: string }[];
  onCreate: (profiles: EnrichmentProfile[], criteria: HubspotCriteria) => void;
  isCreating: boolean;
}) {
  const [criteria, setCriteria] = React.useState<HubspotCriteria>(DEFAULT_CRITERIA);

  const [profiles, setProfiles] = React.useState<EnrichmentProfile[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Panier : id → profil. Persiste à travers les changements de filtre.
  const [cart, setCart] = React.useState<Map<string, EnrichmentProfile>>(new Map());

  // Recherche live (debounced) à chaque changement de filtre.
  const reqId = React.useRef(0);
  React.useEffect(() => {
    const myReq = ++reqId.current;
    setLoading(true);
    setErr(null);
    const t = setTimeout(() => {
      searchHubspot(criteria)
        .then((r) => {
          if (myReq !== reqId.current) return; // une requête plus récente a pris le relais
          setProfiles(r.profiles);
          setHasMore(!!r.hasMore);
        })
        .catch((e) => {
          if (myReq !== reqId.current) return;
          setErr(e instanceof Error ? e.message : "Erreur HubSpot");
          setProfiles([]);
          setHasMore(false);
        })
        .finally(() => {
          if (myReq === reqId.current) setLoading(false);
        });
    }, 600);
    return () => clearTimeout(t);
  }, [criteria]);

  async function loadMore() {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const excludeIds = profiles.map((p) => p.hubspotId).filter((x): x is string => !!x);
      const r = await searchHubspot({ ...criteria, excludeIds });
      const known = new Set(excludeIds);
      const fresh = r.profiles.filter((p) => !p.hubspotId || !known.has(p.hubspotId));
      setProfiles((cur) => [...cur, ...fresh]);
      setHasMore(!!r.hasMore && fresh.length > 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoadingMore(false);
    }
  }

  const toggle = (p: EnrichmentProfile) => {
    const id = idOf(p);
    setCart((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, p);
      return next;
    });
  };

  const allVisibleSelected = profiles.length > 0 && profiles.every((p) => cart.has(idOf(p)));
  const toggleAllVisible = () => {
    setCart((prev) => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        for (const p of profiles) next.delete(idOf(p));
      } else {
        for (const p of profiles) next.set(idOf(p), p);
      }
      return next;
    });
  };

  const cartCount = cart.size;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>
      {/* ── Colonne gauche : filtres ── */}
      <div style={{ width: 320, flexShrink: 0, overflowY: "auto", paddingRight: 2 }}>
        <HubspotFilters value={criteria} onChange={setCriteria} scopeCompanies={scopeCompanies} />
      </div>

      {/* ── Colonne droite : liste réelle + panier ── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${COLORS.line}`,
          borderRadius: 10,
          background: COLORS.bgCard,
          overflow: "hidden",
        }}
      >
        {/* En-tête liste */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: COLORS.ink2 }}>
            {loading ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={13} className="animate-spin" /> Chargement…
              </span>
            ) : (
              <>
                <strong style={{ color: COLORS.ink0 }}>{profiles.length}</strong> contact{profiles.length > 1 ? "s" : ""} affiché
                {profiles.length > 1 ? "s" : ""}
                {hasMore && <span style={{ color: COLORS.ink3 }}> · plus dispos</span>}
              </>
            )}
          </span>
          {profiles.length > 0 && (
            <button type="button" onClick={toggleAllVisible} style={btnSm()}>
              {allVisibleSelected ? "Décocher visibles" : "Cocher visibles"}
            </button>
          )}
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: cartCount > 0 ? COLORS.brand : COLORS.ink3,
            }}
          >
            <ShoppingCart size={14} />
            {cartCount} dans le panier
          </span>
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 240 }}>
          {err ? (
            <p style={{ padding: 24, textAlign: "center", color: COLORS.err, fontSize: 13 }}>Erreur : {err}</p>
          ) : loading && profiles.length === 0 ? (
            <p style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>Chargement des contacts…</p>
          ) : profiles.length === 0 ? (
            <p style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>Aucun contact ne correspond à ces filtres.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {profiles.map((p) => {
                const id = idOf(p);
                const selected = cart.has(id);
                const lc = p.lifecyclestage ? LIFECYCLE_COLORS[p.lifecyclestage] ?? null : null;
                const dealAmount = fmtMoney(p.topDeal?.amount);
                const dealWon = p.topDeal?.isWon === true;
                const dealLost = p.topDeal?.isClosed === true && !dealWon;
                return (
                  <div
                    key={id}
                    onClick={() => toggle(p)}
                    style={{
                      padding: "10px 14px",
                      borderBottom: `1px solid ${COLORS.line}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      cursor: "pointer",
                      background: selected ? COLORS.brandTintSoft : "transparent",
                    }}
                  >
                    {selected ? <CheckSquare size={16} color={COLORS.brand} /> : <Square size={16} color={COLORS.ink4} />}
                    <CompanyAvatar name={p.fullName} size={32} rounded="full" />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.fullName}
                        </span>
                        {lc && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 99,
                              background: lc.bg,
                              color: lc.fg,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.lifecyclestage}
                          </span>
                        )}
                        {p.topDeal && (
                          <span
                            style={{
                              fontSize: 11,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              color: dealWon ? COLORS.ok : dealLost ? COLORS.err : COLORS.info,
                            }}
                            title={p.topDeal.name}
                          >
                            {dealWon ? <Trophy size={11} /> : dealLost ? <XCircle size={11} /> : <Activity size={11} />}
                            {p.topDeal.stageLabel ?? p.topDeal.stage}
                            {dealAmount && <strong>· {dealAmount}</strong>}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.ink2, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {p.jobTitle && <span>{p.jobTitle}</span>}
                        {p.company && <span style={{ color: COLORS.ink3 }}>@ {p.company}</span>}
                        {p.email && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: COLORS.ink2 }}>
                            <Mail size={10} />
                            {p.email}
                          </span>
                        )}
                        {p.username && (
                          <a
                            href={p.profileUrl ?? `https://www.linkedin.com/in/${p.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0a66c2" }}
                          >
                            <Linkedin size={10} />
                            LinkedIn
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Charger plus */}
          {!err && hasMore && profiles.length > 0 && (
            <div style={{ padding: 16, display: "flex", justifyContent: "center", borderTop: `1px solid ${COLORS.line}` }}>
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgCard,
                  color: loadingMore ? COLORS.ink3 : COLORS.ink1,
                  cursor: loadingMore ? "default" : "pointer",
                }}
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Chargement…
                  </>
                ) : (
                  <>
                    <Plus size={13} /> Charger plus
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Pied : créer la liste depuis le panier */}
        <div
          style={{
            padding: "12px 14px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: COLORS.ink2 }}>
            <strong style={{ color: COLORS.ink0 }}>{cartCount}</strong> contact{cartCount > 1 ? "s" : ""} dans le panier
          </span>
          {cartCount > 0 && (
            <button type="button" onClick={() => setCart(new Map())} style={{ ...btnSm(), marginLeft: 4 }}>
              Vider le panier
            </button>
          )}
          <button
            type="button"
            onClick={() => onCreate(Array.from(cart.values()), criteria)}
            disabled={cartCount === 0 || isCreating}
            style={{ ...btnPrimary(), marginLeft: "auto", opacity: cartCount === 0 || isCreating ? 0.5 : 1 }}
          >
            {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Créer la liste ({cartCount})
          </button>
        </div>
      </div>
    </div>
  );
}

function btnSm(): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
  };
}
