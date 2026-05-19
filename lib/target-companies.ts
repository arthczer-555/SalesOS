import { db } from "@/lib/db";

// ── Fonctions dynamiques (lisent depuis DB, fallback sur les valeurs ci-dessous) ──

export async function getTargetCompanies(): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("scope_companies")
      .select("name")
      .order("name", { ascending: true });
    if (!error && data && data.length > 0) {
      return data.map((r) => r.name as string).filter(Boolean);
    }
  } catch { /* fallback */ }
  return TARGET_COMPANIES;
}

export async function getTargetRoles(): Promise<string[]> {
  try {
    const { data } = await db.from("guide_defaults").select("content").eq("key", "target_roles").single();
    if (data?.content) return JSON.parse(data.content as string) as string[];
  } catch { /* fallback */ }
  return TARGET_ROLES;
}

export async function getAlertConfig(): Promise<{ enabled: boolean; slack_channel: string; min_score: number }> {
  try {
    const { data } = await db.from("guide_defaults").select("content").eq("key", "alert_config").single();
    if (data?.content) return JSON.parse(data.content as string);
  } catch { /* fallback */ }
  return { enabled: true, slack_channel: "", min_score: 70 };
}

// ── Valeurs par défaut (fallback si DB vide) ──────────────────────────────

export const TARGET_COMPANIES: string[] = [
  // ── CAC 40 ──
  "Air Liquide",
  "Airbus",
  "Alstom",
  "ArcelorMittal",
  "AXA",
  "BNP Paribas",
  "Bouygues",
  "Capgemini",
  "Carrefour",
  "Crédit Agricole",
  "Danone",
  "Dassault Systèmes",
  "Engie",
  "EssilorLuxottica",
  "Hermès",
  "Kering",
  "L'Oréal",
  "Legrand",
  "LVMH",
  "Michelin",
  "Orange",
  "Pernod Ricard",
  "Publicis",
  "Renault",
  "Safran",
  "Saint-Gobain",
  "Sanofi",
  "Schneider Electric",
  "Société Générale",
  "Stellantis",
  "STMicroelectronics",
  "TotalEnergies",
  "Thales",
  "Unibail-Rodamco-Westfield",
  "Veolia",
  "Vinci",
  "Vivendi",
  "Worldline",

  // ── SBF 120 / Grands comptes FR ──
  "Accor",
  "Atos",
  "Bolloré",
  "Bureau Veritas",
  "Covéa",
  "Decathlon",
  "Edenred",
  "Eiffage",
  "Fnac Darty",
  "Gecina",
  "Imerys",
  "JCDecaux",
  "Klépierre",
  "La Poste",
  "Lagardère",
  "Maisons du Monde",
  "Natixis",
  "Nexans",
  "Nexity",
  "Plastic Omnium",
  "Rexel",
  "Rubis",
  "Sartorius Stedim",
  "SEB",
  "Sodexo",
  "Sopra Steria",
  "Suez",
  "Teleperformance",
  "Valeo",
  "Vallourec",
  "Wendel",
  "Worldline",

  // ── Tech / Scale-ups FR ──
  "OVHcloud",
  "Doctolib",
  "Contentsquare",
  "Mirakl",
  "Datadog",
  "Criteo",
  "Deezer",
  "Back Market",
  "Alan",
  "Qonto",
  "Payfit",
  "Swile",
  "Spendesk",
  "Pigment",
  "Pennylane",
  "Algolia",
  "Ivalua",
  "Talend",
  "Believe",
  "Ledger",

  // ── ETI / Industries ──
  "Roquette",
  "Lesaffre",
  "Bel Group",
  "Bonduelle",
  "Savencia",
  "Limagrain",
  "Avril Group",
  "Lactalis",
  "Bigard",
  "Tereos",
  "Arkema",
  "Eramet",
  "Elior",
  "Korian",
  "Ipsen",
  "bioMérieux",
  "Servier",
  "Pierre Fabre",

  // ── Conseil / Services ──
  "McKinsey France",
  "BCG France",
  "Bain France",
  "Accenture France",
  "Deloitte France",
  "EY France",
  "PwC France",
  "KPMG France",

  // ── Ajoute tes cibles ici ──
];

// ── Postes à surveiller ─────────────────────────────────────────────────────
// Quand un de ces postes change dans une entreprise cible → signal prioritaire.
// Mots-clés utilisés pour les requêtes LinkedIn/web.

export const TARGET_ROLES: string[] = [
  // RH & People
  "DRH",
  "Directeur des Ressources Humaines",
  "VP People",
  "VP RH",
  "Chief People Officer",
  "CPO",
  "CHRO",
  "Chief Human Resources Officer",
  "Head of People",
  "Head of HR",
  "Directeur People",

  // L&D & Talent
  "Directeur L&D",
  "Head of L&D",
  "Head of Learning",
  "VP Learning & Development",
  "Directeur Formation",
  "Head of Talent Development",
  "Talent Development Manager",
  "Learning & Development Manager",
  "Responsable Formation",
  "Responsable Développement des Talents",
  "Head of Talent Management",

  // Transformation & Culture
  "Chief Transformation Officer",
  "Head of Culture",
  "VP Culture",
  "Directeur de la Transformation",
  "Head of Employee Experience",
];

// ── Mots-clés LinkedIn L&D ──────────────────────────────────────────────────
// Pour détecter les posts LinkedIn qui parlent de sujets coaching/L&D.

export const LINKEDIN_KEYWORDS: string[] = [
  "coaching managers",
  "coaching leadership",
  "développement managérial",
  "développement leadership",
  "formation managers",
  "onboarding managers",
  "talent development",
  "learning and development",
  "coaching professionnel",
  "coaching d'équipe",
  "leadership development",
  "manager coaching",
  "executive coaching",
  "QVT qualité de vie au travail",
  "engagement collaborateurs",
  "rétention des talents",
];
