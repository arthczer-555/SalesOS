// Personas (cibles) par défaut + helpers purs. La version éditée par l'équipe
// vit en DB (prospecting_personas, cf. personas-store.ts) ; ces valeurs servent
// de seed au premier chargement et de repli si la DB est indisponible.
//
// RÈGLE : les proofPoints sont les SEULS chiffres / noms de clients que l'IA a le
// droit de citer. Les insights sont des stats de marché tierces, sourcées.
import type { Persona, PersonaMessaging, PersonaTargeting, SourcedText } from "./types";

// Pages Notion de la base de connaissance (registre AGENT_GUIDE.md du repo RAG).
export const KNOWLEDGE_PAGES = {
  messaging: { id: "39f1c2f23b0e81719116cb587ef35a4f", title: "Messaging & prospecting (playbook)" },
  positioning: { id: "39f1c2f23b0e813babe9dbe05be9b4ac", title: "2026 positioning" },
  caseStudies: { id: "3a61c2f23b0e8141a3e3d2e14f3bc212", title: "Client case studies - extended library" },
  roleplay: { id: "3a61c2f23b0e816dae02ed8cbf825b51", title: "AI coaching & role-play" },
} as const;

export const EMPTY_TARGETING: PersonaTargeting = {
  titles: [],
  excludeTitles: [],
  seniorities: [],
  departments: [],
  companySizes: [],
  industries: [],
  locations: [],
  hiringTitles: [],
};

export const EMPTY_MESSAGING: PersonaMessaging = {
  pains: [],
  valueProps: [],
  proofPoints: [],
  insights: [],
  objections: [],
  competitors: [],
  ctas: [],
  tone: "",
  examples: [],
  knowledgePages: [],
};

const COMPANY_FACTS: SourcedText[] = [
  { text: "500 ICF-certified coaches (PCC/MCC) across 12 countries", source: "Legacy prospecting guide (check 2026 positioning)" },
  { text: "100+ clients, including Enedis, Microsoft, Qonto, Salomon, Sodexo, Engie, Spendesk, Adyen", source: "Legacy prospecting guide (check 2026 positioning)" },
];

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "hr_ld",
    name: "HR & L&D leaders",
    description: "CHROs, VPs People, Heads of L&D and Talent: they buy leadership and manager development at scale.",
    color: "#7c3aed",
    is_active: true,
    position: 0,
    targeting: {
      ...EMPTY_TARGETING,
      titles: [
        "CHRO",
        "Chief People Officer",
        "VP People",
        "Head of People",
        "Head of HR",
        "DRH",
        "Directeur des Ressources Humaines",
        "Head of L&D",
        "Head of Learning",
        "VP Learning & Development",
        "Directeur Formation",
        "Head of Talent Development",
        "Head of Talent Management",
        "Learning & Development Manager",
        "Responsable Formation",
      ],
      excludeTitles: ["Recruiter", "Talent Acquisition", "Payroll", "Assistant", "Intern"],
      seniorities: ["c_suite", "vp", "head", "director"],
      departments: ["human_resources"],
      companySizes: ["201-500", "501-1000", "1001-5000", "5001-10000", "10001+"],
    },
    messaging: {
      ...EMPTY_MESSAGING,
      pains: [
        "Developing managers at scale without exploding the budget",
        "Proving the ROI of coaching and training",
        "Moving from theoretical training to real practice",
        "First-time managers left on their own",
        "Engagement and retention of key talent",
      ],
      valueProps: [
        "Hybrid coaching: human ICF coaches plus AI, inside Teams and Slack",
        "Personalized to each manager, aligned with your internal leadership model",
        "Measurable impact with dashboards for HR",
        "AI roleplays to practice real conversations (feedback, conflict, difficult talks)",
      ],
      proofPoints: COMPANY_FACTS,
      competitors: ["BetterUp", "CoachHub", "Ezra", "Simundia", "MoovOne"],
      ctas: ["Worth a 20-minute chat?", "Open to comparing notes on how you develop managers today?"],
      tone: "Warm, concise, peer-to-peer. Name the problem before Coachello. Never explain their job to them.",
      examples: [],
      knowledgePages: [KNOWLEDGE_PAGES.messaging.id, KNOWLEDGE_PAGES.positioning.id, KNOWLEDGE_PAGES.caseStudies.id],
    },
  },
  {
    id: "sales_leaders",
    name: "Sales leaders (AI roleplay)",
    description: "CROs, VPs and Heads of Sales or Sales Enablement: they own quota, ramp time and rep skills.",
    color: "#f01563",
    is_active: true,
    position: 1,
    targeting: {
      ...EMPTY_TARGETING,
      titles: [
        "Chief Revenue Officer",
        "CRO",
        "VP Sales",
        "Vice President Sales",
        "Head of Sales",
        "Sales Director",
        "Director of Sales",
        "Directeur Commercial",
        "Directeur des Ventes",
        "Head of Sales Enablement",
        "Sales Enablement Manager",
        "Revenue Enablement",
        "Head of Business Development",
        "SDR Manager",
        "BDR Manager",
      ],
      excludeTitles: ["Account Executive", "Sales Representative", "Intern", "Assistant", "Inside Sales Representative"],
      seniorities: ["c_suite", "vp", "head", "director"],
      departments: ["sales"],
      companySizes: ["51-200", "201-500", "501-1000", "1001-5000"],
      hiringTitles: ["Account Executive", "Sales Development Representative", "Business Developer", "SDR", "BDR"],
    },
    messaging: {
      ...EMPTY_MESSAGING,
      pains: [
        "Reps miss quota and ramp too slowly",
        "Managers have no time to coach: they sell instead",
        "Discovery and objection handling are inconsistent across the team",
        "New hires practice on real prospects and burn pipeline",
        "Sales training (SKO, playbooks) is forgotten within weeks because nobody practices",
      ],
      valueProps: [
        "AI roleplays built on your ICP, personas and real objections: reps rehearse cold calls, discovery and negotiation before talking to buyers",
        "Each roleplay is scored with feedback, so managers see who needs help without listening to every call",
        "Human coaches for sales managers, to turn managers into coaches",
        "Lives inside Teams and Slack: no new tool to adopt",
      ],
      proofPoints: COMPANY_FACTS,
      insights: [
        { text: "Average quota attainment fell to about 43% in 2025, from 52% the year before", source: "Hyperbound, B2B quota attainment report 2025" },
        { text: "Sales managers are expected to spend half their time coaching but actually spend less than 18%", source: "Kurlan & Associates / Objective Management Group" },
        { text: "Effective coaching lifts quota attainment by about 10 points and win rates by about 7 points", source: "CSO Insights sales enablement study" },
      ],
      objections: [
        { objection: "We already use Gong / call recording", answer: "Recording shows what went wrong after the call. Roleplays let reps fix it before the call, on your own scenarios." },
        { objection: "We already have a sales training provider", answer: "Training gives the method; roleplays give the reps reps. We make the training stick with practice in the flow of work." },
        { objection: "No budget right now", answer: "Offer a pilot on one team and one scenario (ramp of new hires) with a clear metric." },
      ],
      competitors: ["Hyperbound", "Second Nature", "Mindtickle"],
      ctas: [
        "Worth seeing a roleplay built on your ICP?",
        "Open to a 15-minute look at how your new reps could rehearse your top objections?",
      ],
      tone: "Sales-literate, direct, peer to peer. Talk pipeline, ramp, win rate, quota. No HR jargon.",
      examples: [],
      knowledgePages: [KNOWLEDGE_PAGES.messaging.id, KNOWLEDGE_PAGES.positioning.id, KNOWLEDGE_PAGES.roleplay.id, KNOWLEDGE_PAGES.caseStudies.id],
    },
  },
];

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

function sourcedArr(v: unknown): SourcedText[] {
  if (!Array.isArray(v)) return [];
  const out: SourcedText[] = [];
  for (const x of v) {
    if (typeof x === "string") {
      if (x.trim()) out.push({ text: x.trim(), source: null });
    } else if (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string") {
      const item = x as { text: string; source?: unknown };
      if (item.text.trim()) out.push({ text: item.text.trim(), source: typeof item.source === "string" ? item.source : null });
    }
  }
  return out;
}

export function normalizeTargeting(raw: unknown): PersonaTargeting {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    titles: strArr(t.titles),
    excludeTitles: strArr(t.excludeTitles),
    seniorities: strArr(t.seniorities),
    departments: strArr(t.departments),
    companySizes: strArr(t.companySizes),
    industries: strArr(t.industries),
    locations: strArr(t.locations),
    hiringTitles: strArr(t.hiringTitles),
  };
}

export function normalizeMessaging(raw: unknown): PersonaMessaging {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const objections = Array.isArray(m.objections)
    ? m.objections
        .filter((o): o is { objection: string; answer: string } => !!o && typeof o === "object" && typeof (o as { objection?: unknown }).objection === "string")
        .map((o) => ({ objection: o.objection.trim(), answer: typeof o.answer === "string" ? o.answer.trim() : "" }))
    : [];
  return {
    pains: strArr(m.pains),
    valueProps: strArr(m.valueProps),
    proofPoints: sourcedArr(m.proofPoints),
    insights: sourcedArr(m.insights),
    objections,
    competitors: strArr(m.competitors),
    ctas: strArr(m.ctas),
    tone: typeof m.tone === "string" ? m.tone : "",
    examples: strArr(m.examples),
    knowledgePages: strArr(m.knowledgePages),
  };
}

export function normalizePersona(raw: Record<string, unknown>): Persona {
  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : String(raw.id),
    description: typeof raw.description === "string" ? raw.description : "",
    targeting: normalizeTargeting(raw.targeting),
    messaging: normalizeMessaging(raw.messaging),
    color: typeof raw.color === "string" ? raw.color : null,
    is_active: raw.is_active !== false,
    position: typeof raw.position === "number" ? raw.position : 0,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Persona le plus probable pour un intitulé de poste (mots-clés simples). */
export function matchPersona(title: string | null | undefined, personas: Persona[]): Persona | null {
  if (!title) return null;
  const t = norm(title);
  let best: { p: Persona; score: number } | null = null;
  for (const p of personas) {
    if (!p.is_active) continue;
    if (p.targeting.excludeTitles.some((x) => t.includes(norm(x)))) continue;
    let score = 0;
    for (const x of p.targeting.titles) {
      const k = norm(x);
      if (!k) continue;
      if (t === k) score = Math.max(score, 3);
      else if (t.includes(k)) score = Math.max(score, 2);
    }
    if (score === 0) {
      const sales = /\b(sales|revenue|commercial|ventes|business development|enablement|sdr|bdr)\b/.test(t);
      const hr = /\b(hr|people|rh|human resources|ressources humaines|talent|learning|l&d|formation|culture)\b/.test(t);
      if (sales && p.id === "sales_leaders") score = 1;
      if (hr && p.id === "hr_ld") score = 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

/** "201-500" -> "201,500" ; "10001+" -> "10001,1000000" (format Apollo). */
export function sizeToApolloRange(size: string): string | null {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(size.trim());
  if (m) return `${m[1]},${m[2]}`;
  const p = /^(\d+)\+$/.exec(size.trim());
  if (p) return `${p[1]},1000000`;
  return null;
}

export const COMPANY_SIZE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

export const SENIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "c_suite", label: "C-suite" },
  { value: "founder", label: "Founder" },
  { value: "owner", label: "Owner" },
  { value: "partner", label: "Partner" },
  { value: "vp", label: "VP" },
  { value: "head", label: "Head" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "senior", label: "Senior" },
];
