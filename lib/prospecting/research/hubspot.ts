// Historique HubSpot d'un contact pour la recherche prospect : fiche (statut,
// dernier contact) + derniers engagements associés (emails, notes, meetings,
// appels). Lève si HubSpot est inaccessible : l'appelant liste l'erreur.
import { hubspotFetch, stripHtml } from "@/lib/hubspot";

type SearchRow = { id: string; properties?: Record<string, string | null> };

const KINDS = [
  {
    object: "emails",
    label: "Email",
    props: ["hs_email_subject", "hs_email_text", "hs_email_html", "hs_timestamp", "hs_email_direction"],
  },
  { object: "notes", label: "Note", props: ["hs_note_body", "hs_timestamp"] },
  { object: "meetings", label: "Meeting", props: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"] },
  { object: "calls", label: "Call", props: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"] },
] as const;

const MAX_LINES = 8;

function line(kind: (typeof KINDS)[number]["label"], p: Record<string, string | null>): { at: number; text: string } {
  const ts = p.hs_timestamp ? new Date(p.hs_timestamp).getTime() : 0;
  const date = ts ? new Date(ts).toISOString().slice(0, 10) : "date unknown";
  let title = "";
  let body = "";
  if (kind === "Email") {
    const dir = p.hs_email_direction === "INCOMING_EMAIL" ? "reçu du prospect" : "envoyé par Coachello";
    title = `${dir}, sujet "${p.hs_email_subject ?? ""}"`;
    body = p.hs_email_text || stripHtml(p.hs_email_html ?? "");
  } else if (kind === "Note") {
    body = stripHtml(p.hs_note_body ?? "");
  } else if (kind === "Meeting") {
    title = `"${p.hs_meeting_title ?? ""}"${p.hs_meeting_outcome ? ` (${p.hs_meeting_outcome})` : ""}`;
    body = stripHtml(p.hs_meeting_body ?? "");
  } else {
    title = `"${p.hs_call_title ?? ""}"${p.hs_call_disposition ? ` (${p.hs_call_disposition})` : ""}`;
    body = stripHtml(p.hs_call_body ?? "");
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 220);
  return { at: ts, text: `[${date}] ${kind}${title ? ` ${title}` : ""}${snippet ? ` : ${snippet}` : ""}` };
}

export async function fetchContactHubspotHistory(hubspotContactId: string): Promise<string> {
  const contact = await hubspotFetch<{ properties?: Record<string, string | null> }>(
    `/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}?properties=lifecyclestage,hs_lead_status,notes_last_contacted,jobtitle,company`,
  );
  const p = contact.properties ?? {};
  const header = [
    p.lifecyclestage ? `Lifecycle stage : ${p.lifecyclestage}` : null,
    p.hs_lead_status ? `Lead status : ${p.hs_lead_status}` : null,
    p.notes_last_contacted ? `Dernier contact enregistré : ${p.notes_last_contacted.slice(0, 10)}` : null,
  ].filter(Boolean);

  const results = await Promise.allSettled(
    KINDS.map((k) =>
      hubspotFetch<{ results?: SearchRow[] }>(`/crm/v3/objects/${k.object}/search`, "POST", {
        filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: hubspotContactId }] }],
        properties: [...k.props],
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
        limit: 5,
      }).then((r) => (r.results ?? []).map((row) => line(k.label, row.properties ?? {}))),
    ),
  );
  const lines = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_LINES)
    .map((l) => `- ${l.text}`);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === KINDS.length && !header.length) throw new Error("HubSpot engagements unavailable");

  return [
    ...header,
    lines.length ? `Derniers échanges :\n${lines.join("\n")}` : "Aucun échange enregistré dans HubSpot.",
  ].join("\n");
}
