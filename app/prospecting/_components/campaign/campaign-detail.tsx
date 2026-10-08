"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, CheckSquare, Copy, ListOrdered, MoreHorizontal, Pause, Pencil, Play, Settings2, Users } from "lucide-react";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { useProspectingCampaign } from "@/lib/hooks/use-prospecting-campaign";
import { useProspectingOverview } from "@/lib/hooks/use-prospecting-overview";
import { CAMPAIGN_STATUS, MetricValue, PersonaChip, StatusTag } from "../shared/meta";
import { pct } from "../shared/format";
import { sequenceSummary } from "../shared/sequence-mini";
import { SequenceTab } from "../sequence/sequence-tab";
import { LeadsTab } from "../leads/leads-tab";
import { SettingsTab } from "../settings/settings-tab";
import { ReportTab } from "../report/report-tab";
import { ReviewTab } from "../review/review-tab";
import { LaunchButton } from "./launch-button";
import { stepRowToDraft } from "@/lib/prospecting/settings";

type Tab = "sequence" | "prospects" | "review" | "settings" | "report";
const TABS: Tab[] = ["sequence", "prospects", "review", "settings", "report"];
type AddSource = "apollo" | "hubspot" | "csv" | "manual" | "lists" | "watchlist";

// Page d'une campagne : en-tête (nom éditable, statut, lancement), indicateurs,
// et onglets Sequence / Prospects / Review / Settings / Report (?tab=).
export function CampaignDetail({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { campaign, steps, stats, persona, health, error, isLoading, mutate, update, saveSteps, launch, pause, resume, duplicate, archive } = useProspectingCampaign(id);
  const { overview, mutate: refreshOverview } = useProspectingOverview();

  const initialTab = (searchParams?.get("tab") as Tab) ?? null;
  const [tab, setTabState] = React.useState<Tab>(initialTab && TABS.includes(initialTab) ? initialTab : "prospects");
  const [addOpen, setAddOpen] = React.useState(searchParams?.get("add") === "1");
  const [addInitial] = React.useState(() => {
    const listId = searchParams?.get("listId") ?? undefined;
    const scopeCompanyId = searchParams?.get("scopeCompanyId") ?? undefined;
    const source = (searchParams?.get("source") as AddSource | null) ?? (listId ? "lists" : scopeCompanyId ? "watchlist" : undefined);
    return { source, listId, scopeCompanyId };
  });
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const tabInitialized = React.useRef(!!initialTab);

  const setTab = React.useCallback((t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    ["add", "listId", "scopeCompanyId", "source"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Onglet par défaut selon l'état : séquence vide -> Sequence, prospects à revoir -> Review.
  React.useEffect(() => {
    if (tabInitialized.current || !campaign || !stats) return;
    tabInitialized.current = true;
    if (steps.length === 0) setTabState("sequence");
    else if (stats.leads_to_review > 0 && campaign.status === "draft") setTabState("review");
    else if (campaign.status !== "draft" && stats.leads_contacted > 0) setTabState("report");
  }, [campaign, stats, steps.length]);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Banner tone="err" title="Could not load this campaign" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      </div>
    );
  }
  if (isLoading || !campaign) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <Skeleton width={320} height={28} />
        <Skeleton height={70} radius={12} />
        <Skeleton height={380} radius={12} />
      </div>
    );
  }

  const st = stats;
  const refresh = () => {
    void mutate();
    void refreshOverview();
  };
  const tabs: TabItem[] = [
    { key: "sequence", label: "Sequence", icon: ListOrdered },
    { key: "prospects", label: st?.leads_total ? `Prospects ${st.leads_total}` : "Prospects", icon: Users },
    { key: "review", label: "Review", icon: CheckSquare, ...(st && st.leads_to_review > 0 ? { tone: "warn" as const, count: st.leads_to_review } : {}) },
    { key: "settings", label: "Settings", icon: Settings2 },
    { key: "report", label: "Report", icon: BarChart3 },
  ];

  const saveName = async () => {
    setEditingName(false);
    const n = nameDraft.trim();
    if (!n || n === campaign.name) return;
    try {
      await update({ name: n });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not rename", "error");
    }
  };

  const runAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "success");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ background: "#fff", borderBottom: `1px solid ${COLORS.line}`, padding: "14px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <Link href="/prospecting/campaigns" className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Back to campaigns" style={{ marginTop: 2 }}>
            <ArrowLeft size={15} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="ds-input"
                  style={{ fontSize: 19, fontWeight: 800, padding: "2px 8px", maxWidth: 520 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(campaign.name);
                    setEditingName(true);
                  }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: 0, cursor: "text", font: "inherit" }}
                  title="Rename"
                >
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.ink0, letterSpacing: "-0.02em" }}>{campaign.name}</h1>
                  <Pencil size={13} style={{ color: COLORS.ink4 }} />
                </button>
              )}
              <StatusTag map={CAMPAIGN_STATUS} value={campaign.status} />
              {campaign.pause_reason && campaign.status === "paused" ? (
                <span style={{ fontSize: 12, color: COLORS.warn }}>{campaign.pause_reason === "bounce_guard" ? "Auto-paused: too many bounces" : campaign.pause_reason.replace(/_/g, " ")}</span>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap", fontSize: 12.5, color: COLORS.ink3 }}>
              <PersonaChip name={persona?.name ?? null} color={persona?.color} />
              <span>{sequenceSummary(steps.map(stepRowToDraft))}</span>
              {campaign.goal ? <span style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campaign.goal}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {campaign.status === "draft" ? (
              <LaunchButton
                campaign={campaign}
                steps={steps}
                stats={st}
                health={health}
                mailbox={overview?.health ?? null}
                onLaunch={async () => {
                  const res = await launch();
                  refresh();
                  return res;
                }}
                onGoTo={(t) => setTab(t as Tab)}
              />
            ) : campaign.status === "active" ? (
              <Button icon={Pause} onClick={() => void runAction(pause, "Campaign paused")}>
                Pause
              </Button>
            ) : campaign.status === "paused" ? (
              <Button variant="primary" icon={Play} onClick={() => void runAction(resume, "Campaign resumed")}>
                Resume
              </Button>
            ) : null}
            <DropdownMenu
              width={230}
              trigger={({ toggle, ref }) => (
                <button ref={ref} type="button" className="ch-btn ch-btn-icon-only" onClick={toggle} aria-label="More actions">
                  <MoreHorizontal size={15} />
                </button>
              )}
              groups={[
                {
                  items: [
                    {
                      key: "dup",
                      label: "Duplicate",
                      description: "Same sequence and settings, no prospects",
                      icon: Copy,
                      onSelect: async () => {
                        try {
                          const res = await duplicate();
                          if (res.campaign) router.push(`/prospecting/campaigns/${res.campaign.id}?tab=sequence`);
                        } catch (e) {
                          toast(e instanceof Error ? e.message : "Could not duplicate", "error");
                        }
                      },
                    },
                    { key: "settings", label: "Settings", icon: Settings2, onSelect: () => setTab("settings") },
                  ],
                },
              ]}
            />
          </div>
        </div>

        {st ? (
          <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap" }}>
            <Kpi label="Prospects" value={st.leads_total} />
            <Kpi label="Approved" value={st.leads_approved + st.leads_active + st.leads_replied + st.leads_completed} />
            <Kpi label="In sequence" value={st.leads_active} />
            <Kpi label="Contacted" value={st.leads_contacted} />
            <Kpi label="Reply rate" value={st.leads_contacted ? pct(st.leads_replied, st.leads_contacted) : "None yet"} accent />
            <Kpi label="Replied" value={st.leads_replied} />
            <Kpi label="Meetings" value={st.leads_meetings} />
          </div>
        ) : (
          <div style={{ marginTop: 14, fontSize: 12.5 }}>
            <MetricValue value={null} error /> <span style={{ color: COLORS.ink3 }}>Stats could not be loaded.</span>
          </div>
        )}

        <TabBar className="ch-tabs" style={{ marginTop: 10 }} tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />
      </div>

      <div style={{ padding: "18px 24px 56px", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {tab === "sequence" ? (
          <SequenceTab
            campaign={campaign}
            steps={steps}
            persona={persona}
            saveSteps={saveSteps}
            onOutdated={(n) => {
              toast(`${n} prospects have messages written for the old version. Regenerate them from Review.`, "info");
              void mutate();
            }}
          />
        ) : tab === "prospects" ? (
          <LeadsTab
            campaign={campaign}
            stats={st}
            onChanged={refresh}
            addOpen={addOpen}
            setAddOpen={setAddOpen}
            addInitial={addInitial}
            onOpenReview={() => setTab("review")}
          />
        ) : tab === "review" ? (
          <ReviewTab campaignId={campaign.id} campaign={campaign} steps={steps} persona={persona} onChanged={refresh} />
        ) : tab === "settings" ? (
          <SettingsTab
            campaign={campaign}
            health={overview?.health ?? null}
            update={update}
            onMailboxChanged={() => void refreshOverview()}
            onArchive={async () => {
              try {
                await archive(false);
                toast("Campaign archived", "success");
                router.push("/prospecting/campaigns");
              } catch (e) {
                toast(e instanceof Error ? e.message : "Could not archive", "error");
              }
            }}
            onDelete={async () => {
              try {
                await archive(true);
                toast("Draft deleted", "success");
                router.push("/prospecting/campaigns");
              } catch (e) {
                toast(e instanceof Error ? e.message : "Could not delete", "error");
              }
            }}
          />
        ) : (
          <ReportTab campaign={campaign} />
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="ds-kpi-label">{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, color: accent ? COLORS.brandDark : COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </span>
    </div>
  );
}
