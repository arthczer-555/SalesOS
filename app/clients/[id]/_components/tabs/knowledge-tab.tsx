"use client";

import { useState } from "react";
import { Check, Copy, History, Layers, Newspaper, Pencil, Shield, Target, Users, Calendar, AlertTriangle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow, ClientFieldValue, DiscoveredRecording } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { DealRecapPanel } from "../deal-recap-panel";
import { CoachBriefPanel } from "../coach-brief-panel";
import { TimelinePanel, type ClientMeeting } from "../timeline-panel";
import { FieldRows, FieldsCard, sectionRefs, type FieldRef } from "../fields-section";
import { NewsRow } from "../side-cards";
import { WhatsNewCard } from "../whats-new-card";
import { Card, CardHeader } from "../ui";

// Onglet Knowledge : la référence du compte (qui, quoi, comment, historique).
// 2 colonnes : à gauche l'histoire et les objectifs (activité récente, deal
// recap, objectifs, contexte, meetings, news), à droite la fiche (contacts,
// périmètre, IT & accès, planning, brief coachs). Barre d'ancres collée sous le
// header pour sauter à une carte.

const CONTACT_ROLES: Array<{ key: string; role: string }> = [
  { key: "contact_signataire", role: "Signatory" },
  { key: "contact_principal_rh", role: "Primary HR" },
  { key: "contact_rh_operationnel", role: "Operational HR" },
  { key: "contact_facturation", role: "Billing" },
  { key: "contact_it", role: "IT" },
];

const IT_REFS: FieldRef[] = [
  { section: "general_info", key: "contact_it" },
  ...["mode_acces", "sso_details", "provisioning", "provisioning_details", "canal", "statut_app", "meeting_provider", "questionnaire_securite", "dpa", "residence_donnees", "whitelisting_email", "integration_it"].map(
    (key) => ({ section: "org" as const, key }),
  ),
];

type Contact = { name: string; email?: string | null; role?: string | null };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function PersonCard({ role, contact, onAdd }: { role: string; contact: Contact | null; onAdd: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!contact?.name) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: `1px dashed #f2c96b`, background: "#fffdf6", borderRadius: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 99, background: COLORS.warnBg, color: COLORS.warn, display: "grid", placeItems: "center", fontWeight: 700, flexShrink: 0 }}>+</span>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.warn }}>{role}</div>
          <button type="button" className="ch-link" style={{ fontSize: 12.5, color: COLORS.warn }} onClick={onAdd}>
            Missing, add it
          </button>
        </div>
      </div>
    );
  }
  async function copy() {
    if (!contact?.email) return;
    try {
      await navigator.clipboard.writeText(contact.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast(contact.email, "info");
    }
  }
  return (
    <div style={{ display: "flex", gap: 10, padding: 12, border: `1px solid ${COLORS.line}`, borderRadius: 10, minWidth: 0 }}>
      <span style={{ width: 34, height: 34, borderRadius: 99, background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: COLORS.ink1, flexShrink: 0 }}>
        {initials(contact.name)}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.ink3 }}>{role}</div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{contact.name}</div>
        {contact.role && <div style={{ fontSize: 12, color: COLORS.ink2 }}>{contact.role}</div>}
        {contact.email && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: COLORS.ink3, marginTop: 4, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.email}</span>
            <button type="button" onClick={copy} aria-label="Copy email" style={{ background: "none", border: 0, padding: 2, color: copied ? COLORS.ok : COLORS.ink4, cursor: "pointer" }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ContactsCard({ client, onUpdated }: { client: ClientRow; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const gi = (client.fields_json?.general_info ?? {}) as Record<string, ClientFieldValue | undefined>;
  const others = (gi.autres_parties_prenantes?.value as Contact[] | null) ?? [];
  const contactRefs: FieldRef[] = [
    ...CONTACT_ROLES.map((c) => ({ section: "general_info" as const, key: c.key })),
    { section: "general_info", key: "autres_parties_prenantes" },
  ];

  return (
    <Card id="k-contacts" style={{ scrollMarginTop: 64 }}>
      <CardHeader
        icon={Users}
        title="Contacts"
        right={
          <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={12} /> : <Pencil size={12} />}
            {editing ? "Done" : "Edit"}
          </button>
        }
      />
      {editing ? (
        <FieldRows refs={contactRefs} fields={client.fields_json ?? {}} clientId={client.id} onUpdated={onUpdated} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
          {CONTACT_ROLES.map((c) => (
            <PersonCard key={c.key} role={c.role} contact={(gi[c.key]?.value as Contact | null) ?? null} onAdd={() => setEditing(true)} />
          ))}
          {others.length > 0
            ? others.map((o, i) => <PersonCard key={`o${i}`} role="Stakeholder" contact={o} onAdd={() => setEditing(true)} />)
            : <PersonCard role="Other stakeholders" contact={null} onAdd={() => setEditing(true)} />}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <FieldRows
          refs={[
            { section: "general_info", key: "langues_requises" },
            { section: "general_info", key: "zones_geographiques" },
          ]}
          fields={client.fields_json ?? {}}
          clientId={client.id}
          onUpdated={onUpdated}
        />
      </div>
    </Card>
  );
}

function itSummary(client: ClientRow): string | undefined {
  const org = (client.fields_json?.org ?? {}) as Record<string, ClientFieldValue | undefined>;
  const empty = (k: string) => {
    const v = org[k]?.value;
    return v == null || (typeof v === "string" && !v.trim());
  };
  const missing = ["mode_acces", "provisioning", "canal"].filter(empty).length;
  const inProgress = [
    ["statut_app", ["a_demander", "en_validation"]],
    ["questionnaire_securite", ["a_faire", "en_cours"]],
  ].filter(([k, vals]) => (vals as string[]).includes(String(org[k as string]?.value ?? ""))).length;
  const parts = [missing ? `${missing} missing` : null, inProgress ? `${inProgress} in progress` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function KnowledgeTab({
  client,
  meetings,
  onUpdated,
}: {
  client: ClientRow;
  meetings: ClientMeeting[];
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const fields = client.fields_json ?? {};

  async function decline(r: DiscoveredRecording) {
    setDecliningId(r.recording_id);
    try {
      const res = await fetch(`/api/clients/${client.id}/decline-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_id: r.recording_id }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast(`"${r.meeting_title ?? "Meeting"}" removed. Refreshing without it.`, "success");
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the meeting", "error");
    } finally {
      setDecliningId(null);
    }
  }

  const anchors: Array<{ id: string; label: string }> = [
    { id: "k-activity", label: "Recent activity" },
    { id: "k-recap", label: "Deal recap" },
    { id: "k-goals", label: "Goals" },
    { id: "k-history", label: "History" },
    { id: "k-meetings", label: "Meetings" },
    { id: "k-news", label: "News" },
    { id: "k-contacts", label: "Contacts" },
    { id: "k-program", label: "Program" },
    { id: "k-it", label: "IT & access" },
    { id: "k-planning", label: "Planning" },
    { id: "k-brief", label: "Coach brief" },
  ];

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  const newsItems = client.news?.items ?? [];

  return (
    <div>
      <nav
        aria-label="Jump to section"
        style={{
          // Collée sous le header : le conteneur de scroll n'a pas de padding
          // haut (cf. page.tsx), la barre déborde de la gouttière pour masquer
          // le contenu qui défile dessous.
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          gap: 6,
          overflowX: "auto",
          padding: "10px 32px",
          margin: "-24px -32px 16px",
          background: COLORS.bgPage,
          borderBottom: `1px solid ${COLORS.line}`,
          scrollbarWidth: "none",
        }}
      >
        {anchors.map((a) => (
          <button key={a.id} type="button" className="ch-anchor" onClick={() => jump(a.id)}>
            {a.label}
          </button>
        ))}
      </nav>

      <div className="ch-grid-3-2">
        <div className="ch-col">
          <WhatsNewCard
            id="k-activity"
            variant="full"
            insights={client.insights}
            report={client.last_refresh_report}
            news={client.news}
            clientId={client.id}
            onUpdated={onUpdated}
          />
          <DealRecapPanel recap={client.deal_recap} clientId={client.id} onUpdated={onUpdated} />
          <FieldsCard id="k-goals" icon={Target} title="Goals & expectations" refs={sectionRefs("goals")} fields={fields} clientId={client.id} onUpdated={onUpdated} />
          <FieldsCard id="k-history" icon={History} title="Context & history" refs={sectionRefs("history")} fields={fields} clientId={client.id} onUpdated={onUpdated} />
          <TimelinePanel
            meetings={meetings}
            discoveredRecordings={client.discovered_claap_recordings ?? []}
            onDecline={decline}
            decliningId={decliningId}
          />
          <Card id="k-news" style={{ scrollMarginTop: 64 }}>
            <CardHeader icon={Newspaper} title={`Company news (${newsItems.length})`} meta="Last 12 months · important and useful" />
            {(client.news?.errors ?? []).length > 0 && (
              <div style={{ display: "flex", gap: 6, fontSize: 12, color: COLORS.warn, marginBottom: 10 }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                {client.news?.errors?.join(" · ")}
              </div>
            )}
            {newsItems.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.ink3 }}>No company news kept so far.</div>
            ) : (
              newsItems.map((n, i) => <NewsRow key={n.url} n={n} first={i === 0} />)
            )}
          </Card>
        </div>

        <div className="ch-col">
          <ContactsCard client={client} onUpdated={onUpdated} />
          <FieldsCard id="k-program" icon={Layers} title="Program scope" refs={sectionRefs("program_scope")} fields={fields} clientId={client.id} onUpdated={onUpdated} />
          <FieldsCard id="k-it" icon={Shield} title="IT & access" meta={itSummary(client)} refs={IT_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} />
          <FieldsCard
            id="k-planning"
            icon={Calendar}
            title="Planning & organization"
            refs={[
              ...sectionRefs("planning"),
              { section: "org", key: "contraintes_organisationnelles" },
              { section: "org", key: "referentiels_documents" },
            ]}
            fields={fields}
            clientId={client.id}
            onUpdated={onUpdated}
          />
          <CoachBriefPanel
            brief={client.coach_brief ?? null}
            generatedAt={client.coach_brief_generated_at ?? null}
            companyName={client.company_name}
            clientId={client.id}
            onUpdated={onUpdated}
          />
        </div>
      </div>
    </div>
  );
}
