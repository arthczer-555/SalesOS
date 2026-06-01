import {
  listClaapRecordingsPaginated,
  getClaapRecording,
  pickTranscriptUrl,
  extractTitleSearchHint,
  type ClaapRecording,
} from "../claap";
import type { DealSnapshot } from "../hubspot";
import type { ClaapMeetingForClient } from "./context";
import type { MeetingCandidate } from "./types";

// Quand sales_coach_analyses ne contient pas TOUS les meetings du deal — par
// exemple parce qu'ils sont trop anciens ou n'ont jamais été poussés via le
// webhook Claap — on va chercher en direct sur Claap. Match d'un recording au
// deal courant via :
//  - domaine email d'au moins un participant qui matche la company HubSpot ou
//    un contact du deal,
//  - OU titre du recording qui contient un token du nom de la company.
//
// Dédoublonnage : on exclut les recording_id déjà dans sales_coach_analyses,
// passés via `alreadyIndexed` par l'appelant.
//
// Stratégie de fetch (v3) : on paginate Claap mais on ne borne QUE la borne
// basse (createdate − WINDOW_BEFORE_DAYS). Pas de borne haute : les meetings
// post-signature (kickoff, QBR, follow-ups CS, escalades) doivent continuer
// d'apparaître dans la fiche client au fur et à mesure qu'ils sont
// enregistrés. À chaque relance d'enrichissement, on re-scanne et on prend
// les nouveaux.
//
// Concrètement :
//  - Claap renvoie les recordings du plus récent au plus ancien.
//  - On paginate vers le passé jusqu'à ce que la dernière ligne d'une page
//    soit ANTÉRIEURE à windowStart : aucun recording suivant ne pourra
//    matcher la fenêtre.
//  - MAX_RECORDINGS_SCANNED reste élevé (safety net) mais l'early stop sur
//    la date est ce qui termine en pratique.

const WINDOW_BEFORE_DAYS = 30;
const MAX_RECORDINGS_SCANNED = 5000;
const MAX_EXTRA_MATCHES = 50;
const TRANSCRIPT_FETCH_TIMEOUT_MS = 8000;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "pm.me",
  "free.fr", "orange.fr", "sfr.fr", "wanadoo.fr", "laposte.net", "bbox.fr",
  "neuf.fr", "aol.com",
]);

// Notre propre domaine (le vendeur). Il est présent dans QUASI tous les
// recordings Claap (le recorder = nous), donc il n'est jamais distinctif : si un
// contact interne se retrouve sur un deal, matcher dessus ramènerait tous nos
// meetings internes. On l'exclut des domaines de match, comme un domaine public.
const OWN_EMAIL_DOMAINS = new Set(["coachello.io"]);

// Tokens NON distinctifs : formes juridiques + descripteurs génériques. Un
// compte "Fassi Group" ne doit PAS attirer tous les meetings "... Group ..." :
// seul le token distinctif "fassi" peut servir au match par titre. Si le nom de
// company ne contient QUE des tokens génériques, on retombe sur le match par
// domaine email uniquement (aucun match par titre).
const GENERIC_NAME_TOKENS = new Set([
  // formes juridiques (FR / EN / DE / intl)
  "group", "groupe", "holding", "holdings", "company", "compagnie",
  "corp", "corporation", "inc", "incorporated", "ltd", "limited", "llc",
  "llp", "plc", "sas", "sasu", "sarl", "sci", "snc", "gmbh",
  "spa", "srl", "bv", "nv",
  // descripteurs génériques fréquents dans les raisons sociales
  "international", "global", "worldwide", "europe", "france", "labs",
  "solutions", "services", "service", "consulting", "technologies",
  "technology", "systems", "system", "digital", "ventures", "partners",
  "associates", "industries", "industrie", "finance",
  "capital", "invest", "investment", "and",
]);

// Mots de cycle de vente / titres de deal. Le nom d'un deal HubSpot ("Fassi
// Group - New Deal", "Renault — Renewal 2026", "Acme Expansion Q3") contient
// presque toujours ces mots ; s'ils servaient de token de match par titre, ils
// attireraient des dizaines de meetings sans aucun rapport (tout meeting dont
// le titre contient "new" ou "deal"…). On les filtre EN PLUS des tokens
// génériques quand on dérive des tokens depuis le NOM DU DEAL (pas la company).
const DEAL_LIFECYCLE_TOKENS = new Set([
  "new", "deal", "renewal", "renew", "expansion", "expand", "upsell", "upgrade",
  "cross", "sell", "opportunity", "opp", "contract", "quote", "proposal", "poc",
  "pilot", "trial", "demo", "call", "meeting", "review", "won", "lost", "deals",
  "account", "sales", "prospect", "prospection", "lead", "discovery", "kickoff",
  "onboarding", "qbr", "followup", "follow", "intro", "introduction", "sync",
  "checkin", "strategic", "alliance", "project", "projet", "phase", "round",
]);
const DEAL_NAME_NOISE_TOKENS = new Set([...GENERIC_NAME_TOKENS, ...DEAL_LIFECYCLE_TOKENS]);

// Normalise pour comparaison : minuscules + suppression des accents.
function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Découpe une chaîne en mots normalisés (séparateurs = tout sauf alphanumérique).
function tokenizeWords(s: string): string[] {
  return normalizeText(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function extractDomainsFromDeal(deal: DealSnapshot): Set<string> {
  const domains = new Set<string>();
  const isExcluded = (d: string) => PUBLIC_EMAIL_DOMAINS.has(d) || OWN_EMAIL_DOMAINS.has(d);

  const companyDomain = deal.company?.domain?.toLowerCase().trim();
  if (companyDomain && !isExcluded(companyDomain)) domains.add(companyDomain);

  for (const c of deal.contacts ?? []) {
    const email = c.email?.toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    const dom = email.split("@")[1];
    if (dom && !isExcluded(dom)) domains.add(dom);
  }
  return domains;
}

function extractCompanyNameTokens(deal: DealSnapshot): string[] {
  // Tokens DISTINCTIFS utilisés pour matcher le titre d'un recording. Sources :
  //  - nom de la company HubSpot (le plus fiable)
  //  - extraction depuis le nom du deal via le helper existant
  //
  // On normalise (accents), on garde les mots >= 3 caractères, on jette les
  // tokens purement numériques ET les tokens génériques (group, holding, sas…).
  // Sans ce filtre, "Fassi Group" matchait tout meeting contenant "group".
  const tokens = new Set<string>();
  const add = (raw: string, blocklist: Set<string>) => {
    for (const w of tokenizeWords(raw)) {
      if (w.length < 3) continue;
      if (/^\d+$/.test(w)) continue;
      if (blocklist.has(w)) continue;
      tokens.add(w);
    }
  };

  // Source la plus fiable : le nom de la company HubSpot. On ne filtre que les
  // formes juridiques / descripteurs génériques.
  const companyName = deal.company?.name?.trim();
  if (companyName) add(companyName, GENERIC_NAME_TOKENS);

  // Fallback UNIQUEMENT si la company n'a donné aucun token (nom manquant ou
  // purement générique). Le nom du deal est truffé de mots de cycle de vente
  // ("New Deal", "Renewal", "Expansion"…) qui matcheraient des meetings sans
  // rapport : on les filtre en plus (DEAL_NAME_NOISE_TOKENS). On garde l'email
  // recorder "anything@coachello.io" comme proxy pour virer "Coachello".
  if (tokens.size === 0) {
    const hint = extractTitleSearchHint(deal.name, "anything@coachello.io");
    if (hint) add(hint, DEAL_NAME_NOISE_TOKENS);
  }

  return Array.from(tokens);
}

function recordingDateMs(rec: ClaapRecording): number | null {
  const iso = rec.meeting?.startingAt ?? rec.createdAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function recordingMatchesDeal(
  rec: ClaapRecording,
  domains: Set<string>,
  nameTokens: string[],
): boolean {
  // 1. Match par domaine email participant — le signal le plus fort
  if (domains.size > 0) {
    for (const p of rec.meeting?.participants ?? []) {
      const dom = p.email?.toLowerCase().trim().split("@")[1];
      if (dom && domains.has(dom)) return true;
    }
  }
  // 2. Fallback : le titre du recording contient un token DISTINCTIF du nom de
  // la company, en match MOT ENTIER (pas sous-chaîne). Les tokens génériques
  // ont déjà été retirés en amont (cf. extractCompanyNameTokens), donc "Fassi
  // Group" ne matche que sur "fassi", jamais sur "group" / "groupe". Le match
  // mot entier évite aussi que "group" matche "groupe". Utilisé seulement quand
  // le match par domaine email a échoué.
  if (nameTokens.length > 0 && rec.title) {
    const titleWords = new Set(tokenizeWords(rec.title));
    for (const tok of nameTokens) {
      if (titleWords.has(tok)) return true;
    }
  }
  return false;
}

async function fetchTranscriptText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TRANSCRIPT_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Scan partagé : paginate Claap et renvoie les recordings non indexés qui
// matchent le deal (par domaine participant ou token de titre). C'est le cœur
// commun de la discovery complète (avec transcripts, pour l'enrichissement) et
// de la discovery "candidats" (metadata only, pour le popup de confirmation).
async function scanMatchingRecordings(
  deal: DealSnapshot | null,
  alreadyIndexed: Set<string>,
): Promise<ClaapRecording[]> {
  if (!deal || !process.env.CLAAP_API_TOKEN) return [];

  const domains = extractDomainsFromDeal(deal);
  const nameTokens = extractCompanyNameTokens(deal);
  if (domains.size === 0 && nameTokens.length === 0) return [];

  // Calcule la borne basse (et UNIQUEMENT la borne basse) :
  //  - createdate du deal − WINDOW_BEFORE_DAYS pour couvrir la prospection
  //    qui a précédé la création formelle du deal.
  //  - Pas de borne haute : les meetings post-signature (kickoff, QBR,
  //    follow-ups CS) doivent rester captés au fur et à mesure.
  //  - Si createdate manque (rare), fallback 24 mois avant maintenant pour
  //    pas scanner tout l'historique Claap sans raison.
  const createdateMs = deal.createdate
    ? new Date(deal.createdate).getTime()
    : Date.now() - 730 * 24 * 60 * 60 * 1000;
  const windowStart = createdateMs - WINDOW_BEFORE_DAYS * 24 * 60 * 60 * 1000;

  // Claap retourne les recordings du + récent au + ancien. On paginate
  // jusqu'à ce que la page la plus récente passe sous windowStart : aucun
  // recording suivant ne pourra plus matcher.
  let recordings: ClaapRecording[];
  try {
    recordings = await listClaapRecordingsPaginated({
      maxTotal: MAX_RECORDINGS_SCANNED,
      pageSize: 100,
      shouldContinue: (lastRec) => {
        const ms = recordingDateMs(lastRec);
        // Si on n'a pas de date, on continue par prudence
        if (ms === null) return true;
        return ms >= windowStart;
      },
    });
  } catch (e) {
    console.warn(`[clients/claap-discovery] list failed:`, e instanceof Error ? e.message : e);
    return [];
  }

  // Filtre : (date >= windowStart) ET (pas déjà indexé) ET (matche le deal).
  // Pas de borne haute — on accepte explicitement les meetings dans le futur
  // par rapport au close_date (CS post-signature, etc).
  const matches: ClaapRecording[] = [];
  for (const rec of recordings) {
    if (alreadyIndexed.has(rec.id)) continue;
    const ms = recordingDateMs(rec);
    if (ms !== null && ms < windowStart) continue;
    if (!recordingMatchesDeal(rec, domains, nameTokens)) continue;
    matches.push(rec);
    if (matches.length >= MAX_EXTRA_MATCHES) break;
  }

  console.log(
    `[clients/claap-discovery] deal=${deal.id} : matched ${matches.length} Claap recording(s) non indexé(s) ` +
      `(scanned=${recordings.length}, domains=[${Array.from(domains).join(",")}], tokens=[${nameTokens.join(",")}], ` +
      `since=${new Date(windowStart).toISOString().slice(0, 10)})`,
  );
  return matches;
}

export async function discoverExtraClaapMeetings(
  deal: DealSnapshot | null,
  alreadyIndexed: Set<string>,
): Promise<ClaapMeetingForClient[]> {
  const matches = await scanMatchingRecordings(deal, alreadyIndexed);
  if (matches.length === 0) return [];

  // Fetch transcripts en parallèle (max 15 = OK, pas de rate limit côté
  // Claap signed URL S3)
  const transcripts = await Promise.all(
    matches.map((rec) => {
      const url = pickTranscriptUrl(rec);
      return url ? fetchTranscriptText(url) : Promise.resolve(null);
    }),
  );

  return matches.map((rec, i) => recordingToMeeting(rec, transcripts[i]));
}

// Variante "candidats" : metadata seulement (titre/date/url/id), SANS fetch des
// transcripts. Utilisée à l'import pour peupler le popup de confirmation des
// meetings, où l'humain valide la liste avant que l'analyse (coûteuse) démarre.
export async function discoverClaapMeetingCandidates(
  deal: DealSnapshot | null,
  alreadyIndexed: Set<string>,
): Promise<MeetingCandidate[]> {
  const matches = await scanMatchingRecordings(deal, alreadyIndexed);
  return matches.map((rec) => ({
    recording_id: rec.id,
    meeting_title: rec.title ?? null,
    meeting_started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
    claap_url: rec.url ?? null,
    source: "discovered" as const,
  }));
}

// Construit un ClaapMeetingForClient à partir d'un recording brut + son
// transcript déjà chargé.
function recordingToMeeting(rec: ClaapRecording, transcript: string | null): ClaapMeetingForClient {
  return {
    recording_id: rec.id,
    meeting_title: rec.title ?? null,
    meeting_started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
    meeting_kind: null,
    audience: null,
    meeting_recap_summary: null,
    transcript_text: transcript,
    is_discovered: true,
    claap_url: rec.url ?? null,
  };
}

// Charge des recordings Claap précis par leur id (le set confirmé par l'humain),
// transcripts inclus. Utilisé par l'enrichissement post-confirmation : au lieu
// de re-deviner via la discovery aveugle, on traite exactement la liste validée.
// Les ids déjà indexés (alreadyIndexed) sont ignorés, ils arrivent déjà via
// sales_coach_analyses avec leur recap. Best-effort par id : un fetch raté est
// simplement omis.
export async function fetchClaapRecordingsByIds(
  ids: string[],
  alreadyIndexed: Set<string> = new Set(),
): Promise<ClaapMeetingForClient[]> {
  if (!process.env.CLAAP_API_TOKEN) return [];
  const wanted = Array.from(new Set(ids)).filter((id) => id && !alreadyIndexed.has(id));
  if (wanted.length === 0) return [];

  const recs = await Promise.all(
    wanted.map((id) =>
      getClaapRecording(id).catch((e) => {
        console.warn(`[clients/claap-discovery] fetch by id ${id} failed:`, e instanceof Error ? e.message : e);
        return null;
      }),
    ),
  );

  const present = recs.filter((r): r is ClaapRecording => !!r);
  const transcripts = await Promise.all(
    present.map((rec) => {
      const url = pickTranscriptUrl(rec);
      return url ? fetchTranscriptText(url) : Promise.resolve(null);
    }),
  );

  return present.map((rec, i) => recordingToMeeting(rec, transcripts[i]));
}
