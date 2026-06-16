// Synchro best-effort d'une édition de personne vers HubSpot. La base Supabase
// reste la source de vérité ; on ne pousse que si on connaît déjà le contact
// HubSpot. Ne throw jamais (ne doit pas casser une sauvegarde).
import { hubspotUpdate } from "@/lib/hubspot";
import type { OrgPerson, OrgPersonInput } from "./types";

export async function syncPersonToHubspot(person: OrgPerson, changed: OrgPersonInput): Promise<void> {
  if (!person.hubspot_contact_id) return;

  const props: Record<string, string> = {};
  if (changed.title !== undefined && changed.title) props.jobtitle = changed.title;
  else if (changed.title_hubspot !== undefined && changed.title_hubspot)
    props.jobtitle = changed.title_hubspot;

  if (changed.name !== undefined && changed.name) {
    const parts = changed.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length) {
      props.firstname = parts[0];
      if (parts.length > 1) props.lastname = parts.slice(1).join(" ");
    }
  }

  if (changed.email !== undefined && changed.email && changed.email.includes("@")) {
    props.email = changed.email.toLowerCase();
  }

  if (Object.keys(props).length === 0) return;
  try {
    await hubspotUpdate("contacts", person.hubspot_contact_id, props);
  } catch (e) {
    console.warn("[orgchart] hubspot sync failed:", e instanceof Error ? e.message : e);
  }
}
