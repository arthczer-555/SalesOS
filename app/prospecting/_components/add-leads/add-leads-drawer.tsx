"use client";

// Drawer "Add prospects" d'une campagne : navigation des sources à gauche
// (Apollo, HubSpot, CSV / Excel, Manual, Saved lists, Watch List), tray de
// sélection persistant en pied, puis étape de revue (precheck) avant l'ajout.
import * as React from "react";
import { Database, Eye, FileSpreadsheet, ListChecks, Sparkles, Trash2, UserPlus, Users, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Kbd } from "@/components/ui/kbd";
import { Popover } from "@/components/ui/popover";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { EMPTY_APOLLO_FILTERS, leadDisplayName, type SourceKey } from "@/lib/prospecting/sources/shared";
import { ApolloPanel, type ApolloPrefill } from "./source-apollo";
import { CsvPanel } from "./source-csv";
import { HubspotPanel } from "./source-hubspot";
import { ListsPanel } from "./source-lists";
import { ManualPanel } from "./source-manual";
import { WatchlistPanel, type WatchAccountTarget } from "./source-watchlist";
import { ReviewBody, ReviewFooter, useReviewState } from "./review-step";
import { MAX_SELECTION, useLeadSelection, type SelectionApi } from "./selection";
import { Eyebrow, formatCount, modKey } from "./ui";
import { useProspectingPersonas } from "@/lib/hooks/use-prospecting-personas";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const SOURCES: { key: SourceKey; label: string; hint: string; icon: IconType; color: string }[] = [
  { key: "apollo", label: "Apollo", hint: "Find new people", icon: Sparkles, color: COLORS.brand },
  { key: "hubspot", label: "HubSpot", hint: "Your CRM contacts", icon: Database, color: "#ff7a59" },
  { key: "csv", label: "CSV or Excel", hint: "Import a file", icon: FileSpreadsheet, color: "#16a34a" },
  { key: "manual", label: "Manual", hint: "Type or paste", icon: UserPlus, color: "#7c3aed" },
  { key: "lists", label: "Saved lists", hint: "Lists you built", icon: ListChecks, color: "#0891b2" },
  { key: "watchlist", label: "Watch List", hint: "Target accounts", icon: Eye, color: "#ea580c" },
];

const SOURCE_LABEL: Record<SourceKey, string> = {
  apollo: "Apollo",
  hubspot: "HubSpot",
  csv: "CSV",
  manual: "Manual",
  lists: "Lists",
  watchlist: "Watch List",
};

export function AddLeadsDrawer({
  open,
  onClose,
  campaignId,
  personaId,
  onAdded,
  initialSource,
  initialListId,
  initialScopeCompanyId,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  personaId: string | null;
  onAdded: (added: number) => void;
  initialSource?: SourceKey;
  initialListId?: string;
  initialScopeCompanyId?: string;
}) {
  const { toast } = useToast();
  const selection = useLeadSelection();
  const { personas } = useProspectingPersonas();
  const startSource: SourceKey = initialSource ?? (initialListId ? "lists" : initialScopeCompanyId ? "watchlist" : "apollo");
  const [source, setSource] = React.useState<SourceKey>(startSource);
  const [visited, setVisited] = React.useState<Set<SourceKey>>(() => new Set([startSource]));
  const [step, setStep] = React.useState<"pick" | "review">("pick");
  const [apolloPrefill, setApolloPrefill] = React.useState<ApolloPrefill | null>(null);

  // À chaque ouverture : retour au choix des sources, sur la source demandée.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setStep("pick");
      setSource(startSource);
      setVisited((v) => new Set(v).add(startSource));
      setApolloPrefill(null);
    }
    wasOpen.current = open;
  }, [open, startSource]);

  const goTo = (key: SourceKey) => {
    setSource(key);
    setVisited((v) => (v.has(key) ? v : new Set(v).add(key)));
  };

  const findWithApollo = (account: WatchAccountTarget) => {
    const persona = personas.find((p) => p.id === personaId) ?? null;
    setApolloPrefill({
      token: Date.now(),
      label: account.domain ? `People at ${account.name} (${account.domain})` : `People at ${account.name} (matched by company name)`,
      filters: {
        ...EMPTY_APOLLO_FILTERS,
        // On garde la cible du persona (titres, séniorités) mais l'entreprise est imposée.
        titles: persona ? [...persona.targeting.titles] : [],
        seniorities: persona ? [...persona.targeting.seniorities] : [],
        domains: account.domain ? [account.domain] : [],
        organizationName: account.domain ? undefined : account.name,
      },
    });
    goTo("apollo");
  };

  const onFinished = React.useCallback(
    (added: number, message: string, tone: "success" | "info") => {
      toast(message, tone);
      onAdded(added);
      selection.clear();
      setStep("pick");
      onClose();
    },
    [toast, onAdded, selection, onClose],
  );

  const review = useReviewState({ campaignId, items: selection.items, active: open && step === "review", onFinished });

  const canReview = selection.size > 0;
  const startReview = React.useCallback(() => {
    if (canReview) setStep("review");
  }, [canReview]);

  // Raccourci global Ctrl/Cmd + Entrée : revue (étape 1) ou ajout (étape 2).
  // Les panneaux qui l'utilisent pour leur propre action appellent preventDefault.
  const reviewRef = React.useRef(review);
  React.useEffect(() => {
    reviewRef.current = review;
  });
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (step === "pick") startReview();
      else reviewRef.current.confirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, startReview]);

  const close = () => {
    // Job LinkedIn lancé : fermer = clore avec ce qui est déjà ajouté (le job
    // continue côté serveur), avec le bon toast et onAdded.
    if (step === "review" && review.phase === "resolving") {
      review.continueInBackground();
      return;
    }
    onClose();
  };

  const countsByOrigin = React.useMemo(() => {
    const m = new Map<SourceKey, number>();
    for (const it of selection.items) m.set(it.origin, (m.get(it.origin) ?? 0) + 1);
    return m;
  }, [selection.items]);

  return (
    <Drawer
      open={open}
      onClose={close}
      width={980}
      noPadding
      bodyStyle={{ overflow: "hidden", display: "flex" }}
      title="Add prospects"
      subtitle={step === "pick" ? "Pick people from any source, then review them before they join the campaign." : "Last check before adding them to the campaign."}
      headerRight={<Stepper step={step} />}
      footer={
        step === "pick" ? (
          <SelectionTray selection={selection} countsByOrigin={countsByOrigin} onReview={startReview} />
        ) : (
          <ReviewFooter state={review} onBack={() => setStep("pick")} />
        )
      }
    >
      {step === "review" ? (
        <div className="thin-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
          <ReviewBody state={review} onBack={() => setStep("pick")} />
        </div>
      ) : (
        <>
          <nav
            aria-label="Sources"
            className="thin-scrollbar"
            style={{
              width: 212,
              flexShrink: 0,
              overflowY: "auto",
              padding: "16px 12px",
              borderRight: `1px solid ${COLORS.line}`,
              background: COLORS.bgSoft,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Eyebrow style={{ padding: "0 10px 8px" }}>Sources</Eyebrow>
            {SOURCES.map((s) => {
              const Icon = s.icon;
              const n = countsByOrigin.get(s.key) ?? 0;
              const current = source === s.key;
              return (
                <button key={s.key} type="button" className="pg-source-btn" aria-current={current} onClick={() => goTo(s.key)}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      flexShrink: 0,
                      display: "grid",
                      placeItems: "center",
                      color: current ? "#fff" : s.color,
                      background: current ? s.color : `${s.color}14`,
                      transition: "background 0.12s, color 0.12s",
                    }}
                  >
                    <Icon size={14} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block" }}>{s.label}</span>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: COLORS.ink3 }}>{s.hint}</span>
                  </span>
                  {n > 0 ? (
                    <span
                      style={{
                        minWidth: 20,
                        height: 20,
                        padding: "0 6px",
                        borderRadius: 999,
                        background: COLORS.brand,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        display: "inline-grid",
                        placeItems: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {n > 999 ? "999+" : n}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div style={{ margin: "14px 4px 0", padding: 12, borderRadius: 12, background: "#fff", border: `1px solid ${COLORS.line}`, fontSize: 11.5, lineHeight: 1.5, color: COLORS.ink2 }}>
              Mix sources freely. Duplicates, people in another rep&apos;s sequence and the do-not-contact list are caught at review.
            </div>
          </nav>
          <main className="thin-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px 22px 28px" }}>
            {visited.has("apollo") ? (
              <div hidden={source !== "apollo"}>
                <ApolloPanel selection={selection} personaId={personaId} prefill={apolloPrefill} active={open && source === "apollo"} />
              </div>
            ) : null}
            {visited.has("hubspot") ? (
              <div hidden={source !== "hubspot"}>
                <HubspotPanel selection={selection} active={open && source === "hubspot"} />
              </div>
            ) : null}
            {visited.has("csv") ? (
              <div hidden={source !== "csv"}>
                <CsvPanel selection={selection} />
              </div>
            ) : null}
            {visited.has("manual") ? (
              <div hidden={source !== "manual"}>
                <ManualPanel selection={selection} />
              </div>
            ) : null}
            {visited.has("lists") ? (
              <div hidden={source !== "lists"}>
                <ListsPanel selection={selection} initialListId={initialListId} active={open && source === "lists"} />
              </div>
            ) : null}
            {visited.has("watchlist") ? (
              <div hidden={source !== "watchlist"}>
                <WatchlistPanel
                  selection={selection}
                  initialScopeCompanyId={initialScopeCompanyId}
                  active={open && source === "watchlist"}
                  onFindWithApollo={findWithApollo}
                />
              </div>
            ) : null}
          </main>
        </>
      )}
    </Drawer>
  );
}

function Stepper({ step }: { step: "pick" | "review" }) {
  const items: { key: "pick" | "review"; label: string }[] = [
    { key: "pick", label: "Select" },
    { key: "review", label: "Review" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} aria-label="Steps">
      {items.map((it, i) => {
        const active = it.key === step;
        const done = step === "review" && it.key === "pick";
        return (
          <React.Fragment key={it.key}>
            {i > 0 ? <span style={{ width: 14, height: 1, background: COLORS.lineStrong }} /> : null}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: active ? COLORS.ink0 : COLORS.ink3,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "inline-grid",
                  placeItems: "center",
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: active ? COLORS.brand : done ? COLORS.okBg : COLORS.bgSoft,
                  color: active ? "#fff" : done ? COLORS.ok : COLORS.ink3,
                  border: `1px solid ${active ? COLORS.brand : done ? "#c4ecd9" : COLORS.line}`,
                }}
              >
                {i + 1}
              </span>
              {it.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function SelectionTray({
  selection,
  countsByOrigin,
  onReview,
}: {
  selection: SelectionApi;
  countsByOrigin: Map<SourceKey, number>;
  onReview: () => void;
}) {
  const n = selection.size;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      {n === 0 ? (
        <span style={{ fontSize: 12.5, color: COLORS.ink3 }}>Select people from any source. They gather here until you review them.</span>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: COLORS.brandTint,
                color: COLORS.brandDark,
              }}
            >
              <Users size={15} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>{formatCount(n)} selected</div>
              <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 1 }}>
                {Array.from(countsByOrigin.entries())
                  .map(([k, c]) => `${SOURCE_LABEL[k]} ${formatCount(c)}`)
                  .join(" · ")}
              </div>
            </div>
          </div>
          <Popover
            side="top"
            width={380}
            trigger={({ toggle }) => (
              <Button size="sm" variant="ghost" onClick={toggle}>
                View
              </Button>
            )}
          >
            {({ close }) => (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 8px" }}>
                  <Eyebrow>Selection</Eyebrow>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={() => {
                      selection.clear();
                      close();
                    }}
                  >
                    Clear all
                  </Button>
                </div>
                <div className="thin-scrollbar" style={{ maxHeight: 300, overflowY: "auto" }}>
                  {selection.items.slice(0, 200).map((it) => (
                    <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderTop: `1px solid ${COLORS.line}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.label ?? leadDisplayName(it.lead)}
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[it.lead.title, it.lead.companyName].filter(Boolean).join(" · ") || it.lead.email || ""}
                        </div>
                      </div>
                      <Tag size="sm">{SOURCE_LABEL[it.origin]}</Tag>
                      <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Remove" onClick={() => selection.remove([it.key])}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {selection.items.length > 200 ? (
                    <div style={{ fontSize: 11.5, color: COLORS.ink3, padding: "6px 4px" }}>And {formatCount(selection.items.length - 200)} more.</div>
                  ) : null}
                </div>
              </div>
            )}
          </Popover>
          <Button size="sm" variant="ghost" onClick={selection.clear}>
            Clear
          </Button>
          {n >= MAX_SELECTION ? <Tag tone="warn">Limit of {formatCount(MAX_SELECTION)} reached</Tag> : null}
        </>
      )}
      <div style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center", opacity: n ? 1 : 0.4 }} aria-hidden>
        <Kbd>{modKey()}</Kbd>
        <Kbd>Enter</Kbd>
      </span>
      <Button variant="primary" disabled={n === 0} onClick={onReview}>
        {n > 0 ? `Review ${formatCount(n)} prospect${n === 1 ? "" : "s"}` : "Review prospects"}
      </Button>
    </div>
  );
}
