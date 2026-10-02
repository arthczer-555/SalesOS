"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Clock, Loader2, Search, UserCheck } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow } from "@/lib/clients/types";
import { getClientTodo, getHubspotCleanerState } from "@/lib/clients/todo";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { useToast } from "@/components/ui/toast";
import type { ClientMeeting } from "./_components/timeline-panel";
import { ClientHeader } from "./_components/client-header";
import { KeyInsightsTab, type ClientTabKey } from "./_components/tabs/key-insights-tab";
import { KnowledgeTab } from "./_components/tabs/knowledge-tab";
import { TodoTab } from "./_components/tabs/todo-tab";
import { HubspotCleanerTab } from "./_components/tabs/hubspot-cleaner-tab";
import { AssigneesModal } from "./_components/assignees-modal";
import { MeetingConfirmationModal } from "./_components/meeting-confirmation-modal";
import { AnalyzedMeetingsModal } from "./_components/analyzed-meetings-modal";
import { MissingInfoEmailModal } from "./_components/missing-info-email-modal";
import { RefreshReportModal } from "./_components/whats-new-card";

// Fiche client v2 : header (identité, Refresh, Options, onglets) + 4 onglets
// pleine largeur. Ce fichier ne fait que l'orchestration (données, polling du
// refresh, modals) ; le contenu vit dans _components/tabs/*.

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const TAB_KEYS: ClientTabKey[] = ["insights", "knowledge", "todo", "hubspot"];

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type Resp = { client: ClientRow; meetings: ClientMeeting[] };

function StatusBanner({ client, onConfirmMeetings }: { client: ClientRow; onConfirmMeetings: () => void }) {
  const base: React.CSSProperties = { padding: "10px 32px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${COLORS.line}` };
  if (client.enrichment_status === "awaiting_meetings") {
    return (
      <div style={{ ...base, background: COLORS.brandTint, color: COLORS.brandDark }}>
        <Search size={14} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>We found the Claap meetings for this account. Confirm the list (and add any we missed), then the AI analysis starts.</span>
        <button type="button" className="ch-btn ch-btn-sm ch-btn-primary" onClick={onConfirmMeetings}>
          Confirm meetings
        </button>
      </div>
    );
  }
  if (client.enrichment_status === "running") {
    return (
      <div style={{ ...base, background: COLORS.infoBg, color: COLORS.info }}>
        <Loader2 size={14} className="animate-spin" />
        AI enrichment in progress, the page fills in within 1 to 2 minutes.
      </div>
    );
  }
  if (client.enrichment_status === "pending") {
    return (
      <div style={{ ...base, background: COLORS.bgSoft, color: COLORS.ink2 }}>
        <Clock size={14} />
        Waiting for enrichment. An admin can start it from Options, then Run enrichment.
      </div>
    );
  }
  if (client.enrichment_status === "error") {
    return (
      <div style={{ ...base, background: COLORS.errBg, color: COLORS.err, alignItems: "flex-start" }}>
        <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          Enrichment error.
          {client.enrichment_error && <div style={{ marginTop: 4, fontSize: 11.5, opacity: 0.85 }}>{client.enrichment_error}</div>}
        </div>
      </div>
    );
  }
  return null;
}

// Bandeau rose plein, sur tous les onglets, tant que le handover n'est pas fait.
function HandoverBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 32px", background: COLORS.brand, color: "#fff", flexShrink: 0 }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.18)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <UserCheck size={18} />
      </span>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.005em" }}>Do the handover so the CSM is notified and has the data</div>
        <div style={{ fontSize: 12.5, opacity: 0.9 }}>No AM or CS is assigned yet. Pick them and we send them the account context on Slack.</div>
      </div>
      <button type="button" className="ch-btn ch-btn-white" onClick={onOpen}>
        Do the handover
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAdmin } = useUserMe();
  const { toast } = useToast();
  const [tab, setTab] = useState<ClientTabKey>("insights");
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [analyzedMeetingsOpen, setAnalyzedMeetingsOpen] = useState(false);
  const [assigneesMode, setAssigneesMode] = useState<"handover" | "change" | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Distingue une fermeture "confirmée" (on reste sur la fiche, l'enrichissement
  // démarre) d'une fermeture "abandon" (on renvoie vers la liste, cf. gate).
  const confirmedMeetings = useRef(false);
  // Capturés au lancement d'un refresh : servent à détecter la fin du job.
  const refreshBaselineRef = useRef<string | null>(null);
  const refreshDeadlineRef = useRef(0);

  // Onglet dans ?tab= (lien partageable, survit au reload). Lu au montage plutôt
  // que via useSearchParams pour éviter la Suspense boundary.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as ClientTabKey | null;
    if (t && TAB_KEYS.includes(t)) setTab(t);
  }, []);

  const goTo = useCallback((t: ClientTabKey, anchor?: string) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "insights") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
    if (anchor) {
      setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } else {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, []);

  // Polling rapide tant que l'enrichissement tourne, et pendant un refresh
  // (la fiche se met à jour toute seule à la fin du job, sans reload).
  const { data, error, isLoading, mutate } = useSWR<Resp>(`/api/clients/${id}`, fetcher, {
    refreshInterval: (latest) => {
      const s = latest?.client?.enrichment_status;
      if (s === "pending" || s === "running") return 5_000;
      if (refreshing) return 3_000;
      return 0;
    },
    revalidateOnFocus: false,
  });
  const reload = useCallback(() => void mutate(), [mutate]);

  // Ancre du lien (#k-contacts…, posée par CoachelloAI) : le navigateur ne peut
  // pas y scroller seul, la section n'existe qu'une fois la fiche chargée.
  const hashScrolled = useRef(false);
  useEffect(() => {
    if (!data || hashScrolled.current) return;
    hashScrolled.current = true;
    const anchor = decodeURIComponent(window.location.hash.slice(1));
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 60);
  }, [data]);

  // Fin d'un refresh : nouveau report écrit, ou timeout de sécurité. Piloté par
  // `data`, donc robuste à une erreur réseau ponctuelle.
  useEffect(() => {
    if (!refreshing || !data) return;
    const stamp = data.client.last_refresh_report?.refreshed_at ?? null;
    const timedOut = Date.now() > refreshDeadlineRef.current;
    if ((stamp && stamp !== refreshBaselineRef.current) || timedOut) {
      setRefreshing(false);
      if (timedOut) toast("The refresh is taking longer than usual. The page updates once it is done.", "info");
      else if (data.client.last_refresh_report?.error) toast("The refresh failed. Open the refresh details under the Refresh button.", "error");
      else toast("Account refreshed", "success");
    }
  }, [data, refreshing, toast]);

  // Tant que les meetings Claap initiaux ne sont pas confirmés, la fiche n'est
  // pas consultable : le popup de confirmation est un passage obligé.
  const mustConfirmMeetings = data?.client.enrichment_status === "awaiting_meetings";
  useEffect(() => {
    if (mustConfirmMeetings) setConfirmOpen(true);
  }, [mustConfirmMeetings]);

  async function triggerEnrich() {
    setTriggering(true);
    try {
      const res = await fetch(`/api/clients/${id}/enrich`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start the enrichment", "error");
    } finally {
      setTriggering(false);
    }
  }

  async function triggerRefresh() {
    refreshBaselineRef.current = data?.client.last_refresh_report?.refreshed_at ?? null;
    refreshDeadlineRef.current = Date.now() + 5 * 60_000;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/clients/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start the refresh", "error");
      setRefreshing(false);
      return;
    }
    void mutate();
  }

  async function restoreOnboarding() {
    try {
      const res = await fetch(`/api/clients/${id}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: false }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
      goTo("todo");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
    }
  }

  async function deleteClient(companyName: string) {
    if (!window.confirm(`Permanently delete the page for "${companyName}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/clients");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
      setDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: COLORS.ink3, display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={15} className="animate-spin" /> Loading the account…
      </div>
    );
  }
  if (error || !data) {
    return <div style={{ padding: 32, color: COLORS.err }}>{error instanceof Error ? error.message : "Could not load the account"}</div>;
  }

  const { client, meetings } = data;
  const todo = getClientTodo(client);
  const hubspot = getHubspotCleanerState(client);
  const hubspotUrl = HUBSPOT_PORTAL_ID ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${client.hubspot_deal_id}` : null;
  const enriched = client.enrichment_status === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <ClientHeader
        client={client}
        isAdmin={isAdmin}
        refreshing={refreshing}
        triggering={triggering}
        deleting={deleting}
        tab={tab}
        onTab={(t) => goTo(t)}
        todoCount={todo.count}
        hubspotState={hubspot}
        hubspotUrl={hubspotUrl}
        actions={{
          onRefresh: () => void triggerRefresh(),
          onChangeAssignees: () => setAssigneesMode("change"),
          onOpenHandover: () => setAssigneesMode("handover"),
          onDraftEmail: () => setEmailModalOpen(true),
          onCreateVideo: () => router.push(`/video-studio?clientId=${client.id}`),
          onAnalyzedMeetings: () => setAnalyzedMeetingsOpen(true),
          onShowOnboarding: () => void restoreOnboarding(),
          onEnrich: () => void triggerEnrich(),
          onDelete: () => void deleteClient(client.company_name),
          onConfirmMeetings: () => setConfirmOpen(true),
          onOpenReport: () => setReportOpen(true),
        }}
      />

      <StatusBanner client={client} onConfirmMeetings={() => setConfirmOpen(true)} />
      {enriched && todo.handoverPending && <HandoverBanner onOpen={() => setAssigneesMode("handover")} />}
      {refreshing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 32px", background: COLORS.brandTintSoft, borderBottom: `1px solid ${COLORS.line}`, color: COLORS.brandDark, fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
          <Loader2 size={13} className="animate-spin" />
          Refreshing from Claap, HubSpot, Slack and the news. The page updates by itself, usually in under a minute.
        </div>
      )}

      {/* Pas de padding haut sur le conteneur de scroll : les barres collantes
          (ancres de Knowledge) se calent pile sous le header. */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "0 32px 56px" }}>
        <div style={{ paddingTop: 24 }}>
        {tab === "insights" && <KeyInsightsTab client={client} hubspotUrl={hubspotUrl} onUpdated={reload} goTo={goTo} />}
        {tab === "knowledge" && <KnowledgeTab client={client} meetings={meetings} onUpdated={reload} />}
        {tab === "todo" && (
          <TodoTab
            client={client}
            todo={todo}
            onUpdated={reload}
            onOpenHandover={() => setAssigneesMode("handover")}
            onDraftEmail={() => setEmailModalOpen(true)}
          />
        )}
        {tab === "hubspot" && <HubspotCleanerTab client={client} state={hubspot} hubspotUrl={hubspotUrl} onUpdated={reload} />}
        </div>
      </div>
      {reportOpen && (
        <RefreshReportModal
          report={client.last_refresh_report}
          fields={client.fields_json ?? {}}
          clientId={client.id}
          onUpdated={reload}
          onClose={() => setReportOpen(false)}
        />
      )}

      {assigneesMode && (
        <AssigneesModal client={client} mode={assigneesMode} onClose={() => setAssigneesMode(null)} onSaved={reload} />
      )}
      {emailModalOpen && <MissingInfoEmailModal clientId={client.id} onClose={() => setEmailModalOpen(false)} />}
      {analyzedMeetingsOpen && (
        <AnalyzedMeetingsModal clientId={client.id} dealId={client.hubspot_deal_id} onClose={() => setAnalyzedMeetingsOpen(false)} />
      )}
      {confirmOpen && (
        <MeetingConfirmationModal
          clientId={client.id}
          blocking={mustConfirmMeetings}
          onClose={() => {
            setConfirmOpen(false);
            // Fermeture sans confirmation alors que c'est obligatoire : la fiche
            // n'est pas consultable, on renvoie vers la liste.
            if (mustConfirmMeetings && !confirmedMeetings.current) router.push("/clients");
            confirmedMeetings.current = false;
          }}
          onConfirmed={() => {
            confirmedMeetings.current = true;
            void mutate();
          }}
          onDeleted={() => {
            confirmedMeetings.current = true;
            setConfirmOpen(false);
            router.push("/clients");
          }}
        />
      )}
    </div>
  );
}
