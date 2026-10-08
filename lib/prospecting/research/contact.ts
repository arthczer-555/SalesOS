// Recherche par prospect (cache 30 jours dans prospecting_contacts.research) :
// profil et posts LinkedIn, historique HubSpot, envois passés de l'équipe,
// recherche entreprise partagée, puis brief Haiku. Best-effort par source :
// une source en échec est listée dans `errors` (affichée dans Review), jamais
// remplacée par un vide silencieux.
import { db } from "@/lib/db";
import { getPeoplePosts, resolveUsername } from "@/lib/brightdata/linkedin";
import { BRIGHTDATA_API_KEY } from "@/lib/brightdata/serp";
import { fetchLinkedInContext } from "@/lib/prospect-enrichment";
import { errMessage, linkedinUrlFromUsername, linkedinUsernameFromUrl, nowIso } from "../store/util";
import type { ContactResearch, ContactRow, Persona, ResearchSource } from "../types";
import { generateResearchBrief } from "./brief";
import { companyFacts, getCompanyResearch, hiringFacts, newsFacts } from "./company";
import { fetchContactHubspotHistory } from "./hubspot";

export const CONTACT_RESEARCH_TTL_MS = 30 * 86_400_000;
const POSTS_MAX_AGE_MS = 90 * 86_400_000;

export function isResearchFresh(contact: Pick<ContactRow, "research" | "research_at">): boolean {
  return !!contact.research && !!contact.research_at && Date.now() - new Date(contact.research_at).getTime() < CONTACT_RESEARCH_TTL_MS;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface PostFact {
  text: string;
  date: string | null;
  url: string | null;
}

async function recentPosts(username: string, timeoutMs: number): Promise<PostFact[]> {
  const res = await getPeoplePosts(username, { timeoutMs });
  const now = Date.now();
  return (res.data ?? [])
    .map((p) => ({ text: p.text.trim(), ts: p.postedAt ? new Date(p.postedAt).getTime() : NaN, url: p.postUrl || null }))
    .filter((p) => p.text && Number.isFinite(p.ts) && now - p.ts < POSTS_MAX_AGE_MS)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 3)
    .map((p) => ({ text: p.text.slice(0, 600), date: new Date(p.ts).toISOString().slice(0, 10), url: p.url }));
}

async function pastOutreach(email: string): Promise<{ text: string; count: number }> {
  const { data, error } = await db
    .from("outreach_log")
    .select("sent_at, subject, body, sender_email, source")
    .eq("email_lower", email.toLowerCase())
    .order("sent_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { sent_at: string; subject: string | null; body: string | null; sender_email: string | null; source: string }[];
  const text = rows
    .map((r) => {
      const body = (r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
      return `- [${r.sent_at.slice(0, 10)}] ${r.sender_email ?? "a teammate"} : "${r.subject ?? "(no subject)"}"${body ? ` : ${body}` : ""}`;
    })
    .join("\n");
  return { text, count: rows.length };
}

/**
 * Recherche complète d'un prospect. `background` autorise des scrapes longs
 * (job Netlify Background) ; en synchrone on reste sous ~20 s.
 */
export async function getContactResearch(
  contact: ContactRow,
  persona: Persona | null,
  opts: { force?: boolean; background?: boolean; userId?: string | null } = {},
): Promise<ContactResearch> {
  if (!opts.force && isResearchFresh(contact) && contact.research) {
    const cached = contact.research;
    if (cached.brief) return cached;
    // Faits en cache mais brief en échec la dernière fois : on ne re-scrape pas,
    // on refait seulement le brief.
    try {
      const brief = await generateResearchBrief({
        contact,
        persona,
        facts: cached.facts,
        sourceUrls: cached.sources.map((s) => s.url ?? "").filter(Boolean),
        userId: opts.userId ?? null,
      });
      const next: ContactResearch = { ...cached, brief, errors: cached.errors.filter((e) => !e.startsWith("AI brief failed")) };
      await db.from("prospecting_contacts").update({ research: next, research_error: null, updated_at: nowIso() }).eq("id", contact.id);
      return next;
    } catch {
      return cached;
    }
  }

  // Budgets de scrape : en synchrone tout doit tenir sous ~25 s (brief compris) ;
  // en background, une génération de 50 prospects doit tenir dans une fonction.
  const bg = !!opts.background;
  const lookupTimeout = bg ? 15_000 : 8_000;
  const profileTimeout = bg ? 45_000 : 11_000;
  const postsTimeout = bg ? 40_000 : 11_000;
  const errors: string[] = [];
  const sources: ResearchSource[] = [];
  const facts: ContactResearch["facts"] = {};

  // ── LinkedIn : username (connu ou résolu), puis profil + posts en parallèle ──
  const linkedinPromise = (async () => {
    if (!BRIGHTDATA_API_KEY) {
      errors.push("LinkedIn not configured (BRIGHTDATA_API_KEY)");
      return { companyUsername: null as string | null };
    }
    let username = contact.linkedin_username ?? linkedinUsernameFromUrl(contact.linkedin_url);
    if (!username) {
      username = await withTimeout(
        resolveUsername({ firstName: contact.first_name, lastName: contact.last_name, company: contact.company_name ?? undefined }),
        lookupTimeout,
        "LinkedIn lookup",
      ).catch(() => null);
      if (username) {
        // Complète la fiche (best-effort : l'unicité du username peut refuser).
        await db
          .from("prospecting_contacts")
          .update({ linkedin_username: username, linkedin_url: linkedinUrlFromUsername(username), updated_at: nowIso() })
          .eq("id", contact.id)
          .is("linkedin_username", null)
          .then(undefined, () => undefined);
      }
    }
    if (!username) {
      errors.push("LinkedIn profile not found");
      return { companyUsername: null as string | null };
    }
    const profileUrl = linkedinUrlFromUsername(username);
    const [profile, posts] = await Promise.allSettled([
      fetchLinkedInContext(
        { firstName: contact.first_name, lastName: contact.last_name, company: contact.company_name ?? undefined, linkedinUrl: profileUrl },
        { profileTimeoutMs: profileTimeout },
      ),
      recentPosts(username, postsTimeout),
    ]);
    if (profile.status === "fulfilled" && profile.value.text) {
      facts.linkedin = profile.value.text;
      sources.push({ label: "LinkedIn profile", url: profileUrl });
    } else {
      errors.push("LinkedIn profile unavailable (scrape too slow or private)");
    }
    if (posts.status === "fulfilled") {
      if (posts.value.length) {
        facts.posts = posts.value.map((p) => `- [${p.date ?? "date inconnue"}]${p.url ? ` (${p.url})` : ""} ${p.text.replace(/\n+/g, " ")}`).join("\n");
        for (const p of posts.value) sources.push({ label: `LinkedIn post (${p.date ?? "undated"})`, url: p.url, date: p.date });
      }
    } else {
      errors.push(`LinkedIn posts unavailable (${errMessage(posts.reason)})`);
    }
    return { companyUsername: profile.status === "fulfilled" ? profile.value.currentCompanyUsername : null };
  })();

  // ── Entreprise : en parallèle (attendre le slug LinkedIn du profil doublerait
  // le temps par prospect ; le cache par entreprise compense) ──
  const companyPromise = getCompanyResearch({
    name: contact.company_name,
    domain: contact.company_domain,
    persona,
    scopeCompanyId: contact.scope_company_id,
    background: bg,
    force: opts.force,
  });

  const hubspotPromise = contact.hubspot_contact_id
    ? fetchContactHubspotHistory(contact.hubspot_contact_id).then(
        (text) => {
          facts.hubspot = text;
          sources.push({ label: "HubSpot contact history", url: null });
        },
        (e) => {
          errors.push(`HubSpot history unavailable (${errMessage(e)})`);
        },
      )
    : Promise.resolve();

  const outreachPromise = contact.email
    ? pastOutreach(contact.email).then(
        (r) => {
          if (r.count) {
            facts.outreach = r.text;
            sources.push({ label: `${r.count} past email(s) from the team`, url: null });
          }
        },
        (e) => {
          errors.push(`Past emails unavailable (${errMessage(e)})`);
        },
      )
    : Promise.resolve();

  const [, company] = await Promise.all([linkedinPromise, companyPromise, hubspotPromise, outreachPromise]);

  const cf = companyFacts(company);
  if (cf) facts.company = cf;
  if (company.linkedin) sources.push({ label: "Company LinkedIn page", url: null });
  const nf = newsFacts(company);
  if (nf) {
    facts.news = nf;
    for (const n of company.news) sources.push({ label: n.title, url: n.url, date: n.date });
  }
  const hf = hiringFacts(company);
  if (hf) {
    facts.hiring = hf;
    for (const j of company.jobs?.sample.slice(0, 3) ?? []) if (j.url) sources.push({ label: `Job post: ${j.title}`, url: j.url });
  }
  errors.push(...company.errors);

  let brief: ContactResearch["brief"] = null;
  let briefError: string | null = null;
  try {
    brief = await generateResearchBrief({
      contact,
      persona,
      facts,
      sourceUrls: sources.map((s) => s.url ?? "").filter(Boolean),
      userId: opts.userId ?? null,
    });
  } catch (e) {
    briefError = `AI brief failed (${errMessage(e)})`;
    errors.push(briefError);
  }

  const research: ContactResearch = { brief, facts, sources, errors: Array.from(new Set(errors)), fetchedAt: nowIso() };
  const { error } = await db
    .from("prospecting_contacts")
    .update({ research, research_at: research.fetchedAt, research_error: briefError, updated_at: nowIso() })
    .eq("id", contact.id);
  if (error) console.error("[prospecting] research save failed:", error.message);
  return research;
}
