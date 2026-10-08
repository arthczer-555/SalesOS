// Job "research" : (re)fait la recherche d'une liste de prospects en
// background (scrapes LinkedIn longs autorisés), concurrence 3, progression
// persistée et annulation vérifiée entre deux prospects.
import { getContactResearch, isResearchFresh } from "../research/contact";
import { getContact } from "../store/contacts";
import { isJobCanceled, updateJob } from "../store/jobs";
import { getPersona } from "../store/personas";
import { errMessage, mapLimit } from "../store/util";
import type { JobRow, Persona } from "../types";

const CONCURRENCY = 3;

export async function runResearchJob(job: JobRow): Promise<Record<string, unknown>> {
  const raw = job.params as { contactIds?: unknown; force?: unknown };
  const contactIds = Array.isArray(raw.contactIds) ? raw.contactIds.filter((x): x is string => typeof x === "string").slice(0, 1000) : [];
  const force = raw.force === true;
  const total = contactIds.length;
  let done = 0;
  let errors = 0;
  let canceled = false;
  const personas = new Map<string, Promise<Persona | null>>();
  const personaFor = (id: string | null) => {
    if (!id) return Promise.resolve(null);
    if (!personas.has(id)) personas.set(id, getPersona(id));
    return personas.get(id) as Promise<Persona | null>;
  };
  await updateJob(job.id, { progress: { total, done, errors, label: "Researching prospects" } });

  await mapLimit(contactIds, CONCURRENCY, async (id) => {
    if (canceled) return;
    if (await isJobCanceled(job.id)) {
      canceled = true;
      return;
    }
    try {
      const contact = await getContact(id);
      if (!contact) throw new Error("Prospect not found");
      // Reprise : un prospect déjà recherché (et non forcé) est sauté.
      if (force || !isResearchFresh(contact) || !contact.research?.brief) {
        const research = await getContactResearch(contact, await personaFor(contact.persona_id), { force, background: true, userId: job.user_id });
        if (!research.brief) errors++;
      }
    } catch (e) {
      errors++;
      console.error("[prospecting] research job item failed:", errMessage(e));
    }
    done++;
    await updateJob(job.id, { progress: { total, done, errors, label: `Researching prospects (${done}/${total})` } });
  });
  return { total, done, errors, canceled };
}
