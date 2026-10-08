"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Check, Copy, History, Layers, Linkedin, Newspaper, Pencil, Shield, Target, Users, Calendar, AlertTriangle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow, ClientFieldValue, DiscoveredRecording, SectionKey } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { DealRecapPanel } from "../deal-recap-panel";
import { CoachBriefPanel } from "../coach-brief-panel";
import { TimelinePanel, type ClientMeeting } from "../timeline-panel";
import { FieldRows, FieldsCard, sectionRefs, type FieldRef } from "../fields-section";
import { NewsRow } from "../side-cards";
import { WhatsNewCard } from "../whats-new-card";
import { Card, CardHeader, type Collapse } from "../ui";

// Onglet Knowledge : la référence du compte (qui, quoi, comment, historique).
// Mise en page voulue par les CSM, 2 colonnes indépendantes coupées au milieu
// (une carte ouverte d'un côté ne décale pas l'autre colonne) :
//  - gauche : Goals & expectations, IT & access, activité récente, deal recap,
//    contexte, meetings ;
//  - droite : Program scope, Contacts, planning, brief coachs, news.
// Dans chaque carte, ordre "entonnoir" : valeurs courtes en haut (enums,
// Yes/No, dates), listes et textes longs en bas, champs liés gardés ensemble.
// Chaque section se replie (les deux premières rangées ouvertes par défaut,
// choix mémorisé par utilisateur) ; dans les sections, la valeur clé reste
// visible et le détail se déplie au clic (cf. field-display). Barre d'ancres
// collée sous le header : une ancre ouvre sa section avant d'y scroller.

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

const CONTACT_ROLES: Array<{ key: string; role: string }> = [
  { key: "contact_signataire", role: "Signatory" },
  { key: "contact_principal_rh", role: "Primary HR" },
  { key: "contact_rh_operationnel", role: "Operational HR" },
  { key: "contact_facturation", role: "Billing" },
  { key: "contact_it", role: "IT" },
];

// Ordre explicite par carte (pas celui de SECTION_DEFINITIONS) : un field
// ajouté à SECTION_DEFINITIONS doit aussi être placé ici pour apparaître.
const refsOf = (section: SectionKey, keys: string[]): FieldRef[] => keys.map((key) => ({ section, key }));

const PROGRAM_REFS: FieldRef[] = refsOf("program_scope", [
  "nom_programme", "type_coaching", "nb_coaches_estime", "population_accompagnee",
  "auto_assessment", "flash_feedback", "tripartite", "quadripartite",
  "cohortes_format", "offres_associees",
]);

// Paramétrage d'abord, puis conformité, puis le contact IT et les notes.
const IT_REFS: FieldRef[] = [
  ...refsOf("org", [
    "mode_acces", "sso_details", "provisioning", "provisioning_details", "canal", "statut_app", "meeting_provider",
    "questionnaire_securite", "dpa", "whitelisting_email", "residence_donnees",
  ]),
  { section: "general_info", key: "contact_it" },
  { section: "org", key: "integration_it" },
];

// Langues et zones (general_info) vivent ici plutôt que dans Contacts.
const HISTORY_REFS: FieldRef[] = [
  { section: "history", key: "relation_commerciale" },
  ...refsOf("general_info", ["langues_requises", "zones_geographiques"]),
  ...refsOf("history", ["points_de_vigilance", "initiatives_rh_paralleles"]),
];

const PLANNING_REFS: FieldRef[] = [
  ...refsOf("planning", ["kickoff_envisage_le", "fin_contrat_le", "suivi_cs_attendu", "engagements_sales"]),
  ...refsOf("org", ["referentiels_documents", "contraintes_organisationnelles"]),
];

// Ordre de lecture de la page (rangées, puis colonne gauche, puis droite).
const ANCHORS: Array<{ id: string; label: string }> = [
  { id: "k-goals", label: "Goals" },
  { id: "k-program", label: "Program" },
  { id: "k-it", label: "IT & access" },
  { id: "k-contacts", label: "Contacts" },
  { id: "k-activity", label: "Recent activity" },
  { id: "k-recap", label: "Deal recap" },
  { id: "k-history", label: "History" },
  { id: "k-meetings", label: "Meetings" },
  { id: "k-planning", label: "Planning" },
  { id: "k-brief", label: "Coach brief" },
  { id: "k-news", label: "News" },
];

// ── Sections repliables ─────────────────────────────────────────────────
// Mémorisé dans localStorage (confort par utilisateur, même réglage pour tous
// les clients). Stockage indisponible : on retombe sur les défauts, sans erreur.

const SECTIONS_KEY = "coachellohq.clients.knowledge.sections";
const DEFAULT_OPEN = new Set(["k-goals", "k-program", "k-it", "k-contacts"]);

function readSavedSections(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function useSections() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const saved = typeof window === "undefined" ? {} : readSavedSections();
    return Object.fromEntries(ANCHORS.map(({ id }) => [id, typeof saved[id] === "boolean" ? saved[id] : DEFAULT_OPEN.has(id)]));
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(open));
    } catch {
      /* stockage indisponible : l'état reste en mémoire */
    }
  }, [open]);
  const openSection = useCallback((id: string) => setOpen((o) => (o[id] ? o : { ...o, [id]: true })), []);
  const collapse = (id: string): Collapse => ({ open: !!open[id], onToggle: () => setOpen((o) => ({ ...o, [id]: !o[id] })) });
  const setAll = (value: boolean) => setOpen(Object.fromEntries(ANCHORS.map(({ id }) => [id, value])));
  const allOpen = ANCHORS.every(({ id }) => open[id]);
  return { collapse, openSection, setAll, allOpen };
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

// ── Contacts ────────────────────────────────────────────────────────────

type Contact = { name: string; email?: string | null; role?: string | null };
type ContactLink = { hubspotId: string; linkedinUrl: string | null };
type ContactLinks = { links: Record<string, ContactLink> };

async function fetchContactLinks(url: string): Promise<ContactLinks> {
  const res = await fetch(url);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ContactLinks>;
}

// Profil LinkedIn connu de HubSpot, sinon recherche LinkedIn nom + société.
function linkedinHref(contact: Contact, company: string, link: ContactLink | undefined): string {
  const url = link?.linkedinUrl?.trim();
  if (url) return /^https?:\/\//.test(url) ? url : `https://${url}`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${contact.name} ${company}`)}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function PersonCard({
  role,
  contact,
  company,
  link,
  onAdd,
}: {
  role: string;
  contact: Contact | null;
  company: string;
  link?: ContactLink;
  onAdd: () => void;
}) {
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
  const hubspotHref = link && HUBSPOT_PORTAL_ID ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${link.hubspotId}` : null;
  const knownProfile = !!link?.linkedinUrl;
  return (
    <div style={{ display: "flex", gap: 10, padding: 12, border: `1px solid ${COLORS.line}`, borderRadius: 10, minWidth: 0 }}>
      <span style={{ width: 34, height: 34, borderRadius: 99, background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: COLORS.ink1, flexShrink: 0 }}>
        {initials(contact.name)}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.ink3 }}>{role}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {hubspotHref ? (
            <a href={hubspotHref} target="_blank" rel="noreferrer" title="Open the contact in HubSpot" className="ch-person-link">
              {contact.name}
            </a>
          ) : (
            <span style={{ fontWeight: 600, fontSize: 13 }}>{contact.name}</span>
          )}
          <a
            href={linkedinHref(contact, company, link)}
            target="_blank"
            rel="noreferrer"
            title={knownProfile ? "LinkedIn profile" : "Search on LinkedIn"}
            aria-label={knownProfile ? `LinkedIn profile of ${contact.name}` : `Search ${contact.name} on LinkedIn`}
            style={{ display: "inline-flex", color: knownProfile ? "#0A66C2" : COLORS.ink4, flexShrink: 0 }}
          >
            <Linkedin size={13} />
          </a>
        </div>
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

function ContactsCard({ client, onUpdated, collapse }: { client: ClientRow; onUpdated: () => void; collapse: Collapse }) {
  const [editing, setEditing] = useState(false);
  // Liens HubSpot / LinkedIn chargés à part, seulement carte ouverte.
  const { data: linkData, error: linkError } = useSWR<ContactLinks>(
    collapse.open ? `/api/clients/${client.id}/contact-links` : null,
    fetchContactLinks,
    { revalidateOnFocus: false },
  );
  const links = linkData?.links ?? {};
  const linkOf = (c: Contact | null) => (c?.email ? links[c.email.trim().toLowerCase()] : undefined);
  const gi = (client.fields_json?.general_info ?? {}) as Record<string, ClientFieldValue | undefined>;
  const others = (gi.autres_parties_prenantes?.value as Contact[] | null) ?? [];
  const contactRefs: FieldRef[] = [
    ...CONTACT_ROLES.map((c) => ({ section: "general_info" as const, key: c.key })),
    { section: "general_info", key: "autres_parties_prenantes" },
  ];
  const startEditing = () => {
    if (!collapse.open) collapse.onToggle();
    setEditing(true);
  };

  return (
    <Card id="k-contacts" style={{ scrollMarginTop: 64 }}>
      <CardHeader
        icon={Users}
        title="Contacts"
        meta={linkError && collapse.open ? "HubSpot links unavailable" : undefined}
        collapse={collapse}
        right={
          <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => (editing ? setEditing(false) : startEditing())}>
            {editing ? <Check size={12} /> : <Pencil size={12} />}
            {editing ? "Done" : "Edit"}
          </button>
        }
      />
      {collapse.open && (
        <>
          {editing ? (
            <FieldRows refs={contactRefs} fields={client.fields_json ?? {}} clientId={client.id} onUpdated={onUpdated} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
              {CONTACT_ROLES.map((c) => {
                const contact = (gi[c.key]?.value as Contact | null) ?? null;
                return <PersonCard key={c.key} role={c.role} contact={contact} company={client.company_name} link={linkOf(contact)} onAdd={startEditing} />;
              })}
              {others.length > 0
                ? others.map((o, i) => <PersonCard key={`o${i}`} role="Stakeholder" contact={o} company={client.company_name} link={linkOf(o)} onAdd={startEditing} />)
                : <PersonCard role="Other stakeholders" contact={null} company={client.company_name} onAdd={startEditing} />}
            </div>
          )}
        </>
      )}
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
  focus,
}: {
  client: ClientRow;
  meetings: ClientMeeting[];
  onUpdated: () => void;
  // Ancre demandée depuis l'extérieur ("See all" de Key insights, #k-… d'un
  // lien CoachelloAI) : la section s'ouvre puis on y scrolle. `seq` permet de
  // redemander la même ancre.
  focus?: { id: string; seq: number } | null;
}) {
  const { toast } = useToast();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const { collapse, openSection, setAll, allOpen } = useSections();
  const fields = client.fields_json ?? {};

  useEffect(() => {
    if (!focus) return;
    openSection(focus.id);
    const t = setTimeout(() => scrollToSection(focus.id), 60);
    return () => clearTimeout(t);
  }, [focus, openSection]);

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

  function jump(id: string) {
    openSection(id);
    // Laisse la section s'ouvrir avant de scroller.
    requestAnimationFrame(() => scrollToSection(id));
  }

  const newsItems = client.news?.items ?? [];
  const newsCollapse = collapse("k-news");

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
        {ANCHORS.map((a) => (
          <button key={a.id} type="button" className="ch-anchor" onClick={() => jump(a.id)}>
            {a.label}
          </button>
        ))}
        <button type="button" className="ch-anchor ch-anchor-ghost" onClick={() => setAll(!allOpen)}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </nav>

      <div className="ch-grid-2" style={{ alignItems: "start" }}>
        <div className="ch-col">
          <FieldsCard id="k-goals" icon={Target} title="Goals & expectations" refs={sectionRefs("goals")} fields={fields} clientId={client.id} onUpdated={onUpdated} collapse={collapse("k-goals")} />
          <FieldsCard
            id="k-it"
            icon={Shield}
            title="IT & access"
            meta={itSummary(client)}
            refs={IT_REFS}
            fields={fields}
            clientId={client.id}
            onUpdated={onUpdated}
            collapse={collapse("k-it")}
            nestDetails
          />
          <WhatsNewCard
            id="k-activity"
            insights={client.insights}
            report={client.last_refresh_report}
            clientId={client.id}
            onUpdated={onUpdated}
            collapse={collapse("k-activity")}
          />
          <DealRecapPanel recap={client.deal_recap} clientId={client.id} onUpdated={onUpdated} collapse={collapse("k-recap")} />
          <FieldsCard id="k-history" icon={History} title="Context & history" refs={HISTORY_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} collapse={collapse("k-history")} />
          <TimelinePanel
            meetings={meetings}
            discoveredRecordings={client.discovered_claap_recordings ?? []}
            onDecline={decline}
            decliningId={decliningId}
            collapse={collapse("k-meetings")}
          />
        </div>

        <div className="ch-col">
          <FieldsCard id="k-program" icon={Layers} title="Program scope" refs={PROGRAM_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} collapse={collapse("k-program")} />
          <ContactsCard client={client} onUpdated={onUpdated} collapse={collapse("k-contacts")} />
          <FieldsCard
            id="k-planning"
            icon={Calendar}
            title="Planning & organization"
            refs={PLANNING_REFS}
            fields={fields}
            clientId={client.id}
            onUpdated={onUpdated}
            collapse={collapse("k-planning")}
          />
          <CoachBriefPanel
            brief={client.coach_brief ?? null}
            generatedAt={client.coach_brief_generated_at ?? null}
            companyName={client.company_name}
            clientId={client.id}
            onUpdated={onUpdated}
            collapse={collapse("k-brief")}
          />
          <Card id="k-news" style={{ scrollMarginTop: 64 }}>
            <CardHeader icon={Newspaper} title={`Company news (${newsItems.length})`} meta="Last 12 months · important and useful" collapse={newsCollapse} />
            {newsCollapse.open && (
              <>
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
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
