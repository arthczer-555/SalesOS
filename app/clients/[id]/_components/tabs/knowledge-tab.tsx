"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Check, Copy, Linkedin, Pencil } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { ClientRow, ClientFieldValue, DiscoveredRecording, SectionKey } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { DealRecapPanel } from "../deal-recap-panel";
import { CoachBriefPanel } from "../coach-brief-panel";
import { TimelinePanel, meetingCount, type ClientMeeting } from "../timeline-panel";
import { FieldRows, FieldsCard, hasMissingKeyField, sectionRefs, type FieldRef } from "../fields-section";
import { NewsErrors, NewsRow } from "../side-cards";
import { WhatsNewCard } from "../whats-new-card";
import { BareCards, Card, CardHeader } from "../ui";

// Onglet Knowledge : la référence du compte (qui, quoi, comment, historique).
// Sidebar à gauche (Account / History / Tools), une section affichée à la
// fois à droite, en pleine page (<BareCards> : les cartes perdent leur cadre).
// Pastille orange = un champ clé de la section est vide ; compteurs sur
// Meetings et Company news. La section choisie est dans l'ancre de l'URL
// (?tab=knowledge#k-contacts), que CoachelloAI met dans ses liens.
// Dans chaque section, ordre "entonnoir" : valeurs courtes en haut (enums,
// Yes/No, dates), listes et textes longs en bas, champs liés gardés ensemble ;
// la valeur clé reste visible et le détail se déplie au clic (cf. field-display).

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

const CONTACT_ROLES: Array<{ key: string; role: string }> = [
  { key: "contact_signataire", role: "Signatory" },
  { key: "contact_principal_rh", role: "Primary HR" },
  { key: "contact_rh_operationnel", role: "Operational HR" },
  { key: "contact_facturation", role: "Billing" },
  { key: "contact_it", role: "IT" },
];

// Ordre explicite par section (pas celui de SECTION_DEFINITIONS) : un field
// ajouté à SECTION_DEFINITIONS doit aussi être placé ici pour apparaître.
const refsOf = (section: SectionKey, keys: string[]): FieldRef[] => keys.map((key) => ({ section, key }));

const GOALS_REFS: FieldRef[] = sectionRefs("goals");

const PROGRAM_REFS: FieldRef[] = refsOf("program_scope", [
  "nom_programme", "type_coaching", "nb_coaches_estime", "population_accompagnee",
  "auto_assessment", "flash_feedback", "tripartite", "quadripartite",
  "cohortes_format", "offres_associees",
]);

const CONTACT_REFS: FieldRef[] = [
  ...CONTACT_ROLES.map((c) => ({ section: "general_info" as const, key: c.key })),
  { section: "general_info", key: "autres_parties_prenantes" },
];

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

// Les ids (k-…) sont aussi les ancres des liens CoachelloAI : ne pas les renommer.
type SectionId =
  | "k-goals" | "k-program" | "k-contacts" | "k-it" | "k-planning"
  | "k-recap" | "k-history" | "k-meetings" | "k-activity" | "k-news"
  | "k-brief";

const NAV: Array<{ group: string; items: Array<{ id: SectionId; label: string; refs?: FieldRef[] }> }> = [
  {
    group: "Account",
    items: [
      { id: "k-goals", label: "Goals & expectations", refs: GOALS_REFS },
      { id: "k-program", label: "Program scope", refs: PROGRAM_REFS },
      { id: "k-contacts", label: "Contacts", refs: CONTACT_REFS },
      { id: "k-it", label: "IT & access", refs: IT_REFS },
      { id: "k-planning", label: "Planning", refs: PLANNING_REFS },
    ],
  },
  {
    group: "History",
    items: [
      { id: "k-recap", label: "Deal recap" },
      { id: "k-history", label: "Context & history", refs: HISTORY_REFS },
      { id: "k-meetings", label: "Meetings" },
      { id: "k-activity", label: "Recent activity" },
      { id: "k-news", label: "Company news" },
    ],
  },
  { group: "Tools", items: [{ id: "k-brief", label: "Coach brief" }] },
];

const SECTION_IDS = new Set<string>(NAV.flatMap((g) => g.items.map((i) => i.id)));
const DEFAULT_SECTION: SectionId = "k-goals";

function isSectionId(id: string): id is SectionId {
  return SECTION_IDS.has(id);
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
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: `1px dashed ${COLORS.warnLine}`, background: COLORS.warnTint, borderRadius: 10 }}>
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
      <span style={{ width: 34, height: 34, borderRadius: 99, background: COLORS.sand, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: COLORS.ink1, flexShrink: 0 }}>
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

function ContactsCard({ client, onUpdated }: { client: ClientRow; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  // Liens HubSpot / LinkedIn chargés à part, seulement quand la section est affichée.
  const { data: linkData, error: linkError } = useSWR<ContactLinks>(`/api/clients/${client.id}/contact-links`, fetchContactLinks, {
    revalidateOnFocus: false,
  });
  const links = linkData?.links ?? {};
  const linkOf = (c: Contact | null) => (c?.email ? links[c.email.trim().toLowerCase()] : undefined);
  const gi = (client.fields_json?.general_info ?? {}) as Record<string, ClientFieldValue | undefined>;
  const others = (gi.autres_parties_prenantes?.value as Contact[] | null) ?? [];

  return (
    <Card id="k-contacts">
      <CardHeader
        title="Contacts"
        meta={linkError ? "HubSpot links unavailable" : undefined}
        right={
          <button type="button" className="ch-btn ch-btn-sm" onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={12} /> : <Pencil size={12} />}
            {editing ? "Done" : "Edit"}
          </button>
        }
      />
      {editing ? (
        <FieldRows refs={CONTACT_REFS} fields={client.fields_json ?? {}} clientId={client.id} onUpdated={onUpdated} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {CONTACT_ROLES.map((c) => {
            const contact = (gi[c.key]?.value as Contact | null) ?? null;
            return <PersonCard key={c.key} role={c.role} contact={contact} company={client.company_name} link={linkOf(contact)} onAdd={() => setEditing(true)} />;
          })}
          {others.length > 0
            ? others.map((o, i) => <PersonCard key={`o${i}`} role="Stakeholder" contact={o} company={client.company_name} link={linkOf(o)} onAdd={() => setEditing(true)} />)
            : <PersonCard role="Other stakeholders" contact={null} company={client.company_name} onAdd={() => setEditing(true)} />}
        </div>
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
  // Section demandée depuis l'extérieur ("See all" de Key insights, #k-… d'un
  // lien CoachelloAI). `seq` (horodatage) permet de redemander la même.
  focus?: { id: string; seq: number } | null;
}) {
  const { toast } = useToast();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  // Dernier choix gagnant entre un clic dans la sidebar et une demande externe.
  const [picked, setPicked] = useState<{ id: SectionId; at: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const fields = client.fields_json ?? {};

  const requested = focus && isSectionId(focus.id) ? { id: focus.id, at: focus.seq } : null;
  const active: SectionId = [picked, requested].reduce<{ id: SectionId; at: number } | null>(
    (best, c) => (c && (!best || c.at > best.at) ? c : best),
    null,
  )?.id ?? DEFAULT_SECTION;

  function select(id: SectionId) {
    setPicked({ id, at: Date.now() });
    // Ancre dans l'URL : lien partageable vers la section, comme ceux de CoachelloAI.
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", url.toString());
    // Page défilée dans une longue section : on remonte en haut de la nouvelle
    // (la sidebar, collante, reste à sa place).
    const root = rootRef.current;
    const nav = navRef.current;
    if (root && nav && root.getBoundingClientRect().top < nav.getBoundingClientRect().top - 1) root.scrollIntoView({ block: "start" });
  }

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

  const newsItems = client.news?.items ?? [];
  const counts: Partial<Record<SectionId, number>> = {
    "k-meetings": meetingCount(meetings, client.discovered_claap_recordings ?? []),
    "k-news": newsItems.length,
  };

  function section() {
    switch (active) {
      case "k-goals":
        return <FieldsCard id="k-goals" title="Goals & expectations" refs={GOALS_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} />;
      case "k-program":
        return <FieldsCard id="k-program" title="Program scope" refs={PROGRAM_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} />;
      case "k-contacts":
        return <ContactsCard client={client} onUpdated={onUpdated} />;
      case "k-it":
        return (
          <FieldsCard id="k-it" title="IT & access" meta={itSummary(client)} refs={IT_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} nestDetails />
        );
      case "k-planning":
        return <FieldsCard id="k-planning" title="Planning & organization" refs={PLANNING_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} />;
      case "k-recap":
        return <DealRecapPanel recap={client.deal_recap} clientId={client.id} onUpdated={onUpdated} />;
      case "k-history":
        return <FieldsCard id="k-history" title="Context & history" refs={HISTORY_REFS} fields={fields} clientId={client.id} onUpdated={onUpdated} />;
      case "k-meetings":
        return (
          <TimelinePanel
            meetings={meetings}
            discoveredRecordings={client.discovered_claap_recordings ?? []}
            onDecline={decline}
            decliningId={decliningId}
          />
        );
      case "k-activity":
        return <WhatsNewCard id="k-activity" insights={client.insights} report={client.last_refresh_report} clientId={client.id} onUpdated={onUpdated} />;
      case "k-news":
        return (
          <Card id="k-news">
            <CardHeader title={`Company news (${newsItems.length})`} meta="Last 12 months · important and useful" />
            <NewsErrors errors={client.news?.errors ?? []} />
            {newsItems.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.ink3 }}>No company news kept so far.</div>
            ) : (
              newsItems.map((n, i) => <NewsRow key={n.url} n={n} first={i === 0} />)
            )}
          </Card>
        );
      case "k-brief":
        return (
          <CoachBriefPanel
            brief={client.coach_brief ?? null}
            generatedAt={client.coach_brief_generated_at ?? null}
            companyName={client.company_name}
            clientId={client.id}
            onUpdated={onUpdated}
          />
        );
    }
  }

  return (
    <div ref={rootRef} className="ch-kn" style={{ scrollMarginTop: 24 }}>
      <nav ref={navRef} className="ch-kn-nav" aria-label="Knowledge sections">
        {NAV.map((g, gi) => (
          <div key={g.group} style={{ display: "contents" }}>
            <div className="ch-kn-group" style={gi === 0 ? { paddingTop: 6 } : undefined}>
              {g.group}
            </div>
            {g.items.map((item) => {
              const count = counts[item.id];
              const missing = item.refs ? hasMissingKeyField(item.refs, fields) : false;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="ch-kn-item"
                  aria-current={active === item.id}
                  onClick={() => select(item.id)}
                  title={missing ? "Some key info is missing in this section" : undefined}
                >
                  {item.label}
                  {missing ? (
                    <span className="ch-kn-dot" aria-label="Key info missing" />
                  ) : count != null && count > 0 ? (
                    <span className="ch-kn-meta">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        key={active}
        style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 14,
          padding: "24px 28px 28px",
          minWidth: 0,
          minHeight: 320,
        }}
      >
        <BareCards>{section()}</BareCards>
      </div>
    </div>
  );
}
