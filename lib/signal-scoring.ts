import Anthropic from "@anthropic-ai/sdk";

// ── Tool use schema for signal scoring ──────────────────────────────────────

export const signalScoringTool: Anthropic.Tool = {
  name: "score_signals",
  description: "Score et analyse les signaux de marché pour Coachello",
  input_schema: {
    type: "object" as const,
    properties: {
      signals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "Recopie EXACTEMENT le numéro [N] de l'item analysé (le crochet en tête de chaque item). Sert à rattacher le signal à sa source. Obligatoire." },
            company_name: { type: "string", description: "Nom exact de l'entreprise qui est le SUJET PRINCIPAL de l'article (celle concernée par l'évènement). Si une personne change d'entreprise, c'est la NOUVELLE entreprise. Pas une société citée en passant." },
            signal_type: {
              type: "string",
              enum: ["funding", "hiring", "nomination", "expansion", "restructuring", "content", "job_change", "linkedin_post"],
              description: "Type de signal détecté",
            },
            title: { type: "string", description: "Titre concis < 80 caractères, fait concret" },
            dedupe_signature: {
              type: "string",
              description:
                "Empreinte STABLE et DÉTERMINISTE du fait, pour dédupliquer la même info venue de plusieurs sources/URLs. Minuscules, sans ponctuation ni accents, uniquement les mots-clés essentiels qui IDENTIFIENT l'évènement : personne/entité concernée + action + société. Ordre fixe : personne, action, société. DOIT être identique pour le même évènement même si l'article est rédigé autrement. N'inclus NI date, NI chiffres variables, NI adjectifs, NI nom de média. Ex: 'agnes park nomination drh sodexo', 'sodexo levee de fonds serie b', 'doctolib recrutement massif managers'.",
            },
            summary: { type: "string", description: "2-3 phrases avec détails clés (chiffres, noms, dates)" },
            signal_date: { type: "string", description: "Date YYYY-MM ou null" },
            source_url: { type: "string", description: "URL de la source" },
            source_domain: { type: "string", description: "Domaine de la source (ex: lesechos.fr)" },
            score: {
              type: "integer",
              description: "Score de pertinence 0-100 pour Coachello",
            },
            score_breakdown: {
              type: "object",
              properties: {
                icp: { type: "integer", description: "Proximité ICP Coachello 0-25 : entreprise qui pourrait acheter du coaching ?" },
                actionability: { type: "integer", description: "Actionnabilité 0-25 : peut-on contacter quelqu'un suite à ce signal ?" },
                freshness: { type: "integer", description: "Fraîcheur 0-20 : < 3 jours = 20, < 7 jours = 15, < 14 jours = 10, > 14 jours = 5" },
                source_reliability: { type: "integer", description: "Fiabilité source 0-15 : presse nationale/LinkedIn = 15, presse spécialisée = 10, blog = 5" },
                signal_strength: { type: "integer", description: "Force du signal 0-15 : levée > 10M€ = 15, nomination C-level = 12, recrutement = 8, contenu = 5" },
              },
              required: ["icp", "actionability", "freshness", "source_reliability", "signal_strength"],
            },
            why_relevant: { type: "string", description: "1-2 phrases : pourquoi ce signal est pertinent pour Coachello (coaching managers, développement leadership)" },
            suggested_action: { type: "string", description: "1 phrase : action concrète recommandée (ex: 'Contacter le nouveau DRH pour proposer un programme coaching managers')" },
            action_type: {
              type: "string",
              enum: ["email", "linkedin", "call", "monitor"],
              description: "Type d'action recommandée",
            },
          },
          required: ["index", "company_name", "signal_type", "title", "dedupe_signature", "summary", "score", "score_breakdown", "why_relevant", "suggested_action", "action_type"],
        },
      },
    },
    required: ["signals"],
  },
};

// ── System prompt for signal analysis ───────────────────────────────────────

export const SIGNAL_ANALYSIS_PROMPT = `Tu es un expert en intelligence commerciale pour Coachello, une plateforme de coaching professionnel B2B (coaching individuel et collectif pour managers et leaders, combinant IA et coaching humain).

Tu analyses des articles web pour identifier des signaux d'achat pertinents pour Coachello.

## Signaux forts pour Coachello :
- **Levées de fonds** (> 5M€) : post-levée = besoin de structurer l'équipe management → coaching
- **Nominations DRH / VP People / Head of L&D** : nouveau décideur = fenêtre d'attention ouverte
- **Recrutement massif managers** : scaling = besoin de développer les nouveaux managers
- **Expansion internationale** : nouveaux pays = besoin de leadership interculturel
- **Restructuration / transformation** : changement = besoin d'accompagnement des managers
- **Certifications GPTW / Top Employer** : entreprise qui investit dans les RH
- **Changements de poste RH/L&D** (signal_type: "job_change") : quand un DRH, VP People, Head of L&D ou responsable formation change de poste dans un grand compte → signal TRÈS fort (nouveau décideur, fenêtre 90 jours)

## Filtre de pertinence Coachello (GATE, à appliquer AVANT tout scoring)
Deux familles de signaux sont valides. Tout le reste ne doit PAS être émis.

### Famille 1 - Évènements d'entreprise (à GARDER largement, y compris en news générale de marché)
Tout changement structurel, de croissance ou d'organisation qui crée un besoin d'accompagner les managers. Ces news sont VOULUES même sans décideur RH nommé :
- levée de fonds, financement, série A/B/C
- acquisition, fusion, M&A, rachat
- expansion (international, nouveaux marchés, ouverture de bureaux)
- restructuration, réorganisation, plan social, transformation
- recrutement massif, scaling des équipes ou des managers
- programme de développement du leadership ou des managers, certification GPTW / Top Employer

### Famille 2 - Changements de décideurs : UNIQUEMENT côté RH / People / L&D / Talent
- À GARDER : nomination ou arrivée d'un(e) DRH, CHRO, Chief People Officer, VP People, VP Talent, Head of L&D, directeur(rice) formation, CLO, HRBP senior.
- À EXCLURE ABSOLUMENT : toute nomination d'un dirigeant HORS RH/People/L&D, par exemple CRO (Chief Revenue Officer), CEO, CFO, CMO, CTO, CIO, COO, VP Sales, VP Marketing, directeur commercial, directeur produit. Ce ne sont PAS des acheteurs Coachello. Si le poste nommé n'est pas clairement RH/People/L&D/Talent, NE PAS émettre.

### Famille 3 - Posts LinkedIn intéressants (items tagués [LinkedIn post], signal_type: "linkedin_post")
Certains items sont des posts LinkedIn découverts par mots-clés (l'auteur n'est PAS forcément dans nos comptes : c'est de la découverte). L'auteur du post est la personne à contacter. À GARDER quand le post RÉVÈLE un besoin ou un contexte favorable au coaching / développement du leadership, même sans événement formel daté :
- scaling / croissance d'équipe, arrivée de nouveaux managers, structuration du management
- lancement d'un programme leadership / L&D / formation / mentoring / coaching interne
- transformation, réorganisation, conduite du changement
- culture, engagement, QVT, bien-être au travail, onboarding / intégration
- réflexion d'un décideur ou manager (RH, People, L&D, dirigeant) sur le management, le leadership ou le développement des équipes
À EXCLURE : post purement promotionnel / produit, repartage sans propos, offre d'emploi brute, citation inspirante creuse, contenu générique sans angle management / leadership / RH.
Scoring spécifique aux posts : company_name = l'employeur de l'auteur s'il est identifiable dans le post, sinon laisse le nom de l'auteur. signal_strength jusqu'à 12 si le besoin est explicite (programme annoncé, scaling, transformation), 6-8 si l'intention reste implicite. actionnabilité élevée (on connaît l'auteur et on peut le contacter).

### À exclure dans tous les cas (hors sujet, jamais un signal)
- lancement de produit / fonctionnalité, annonce technologique ou IA produit
- résultats financiers trimestriels, chiffre d'affaires, cours de bourse (à ne pas confondre avec une levée de fonds, qui elle est voulue)
- partenariat ou contrat purement commercial, campagne marketing / publicité
- prix ou récompense produit / tech sans lien avec l'employeur ou les RH
- litige, procès, amende

## Règles strictes :
1. Un signal = un fait daté, précis, sourcé. Pas d'articles génériques (pages "À propos", articles sans date).
2. Si l'article ne contient pas de fait concret et récent → ne pas créer de signal.
3. Ne JAMAIS fabriquer d'informations. Si une date n'est pas claire, mettre null.
4. Un signal par événement. Pas de doublons (même événement = 1 signal).
5. Score honnête : un article blog vague sur un sujet générique = score < 30, pas 70+.
6. Préférer peu de signaux de qualité à beaucoup de signaux médiocres.

## Scoring (total = somme des 5 critères) :
- **ICP (0-25)** : L'entreprise est-elle dans la cible Coachello ? ETI/grand groupe avec 100+ employés = 20-25, PME = 10-15, micro-entreprise = 0-5
- **Actionnabilité (0-25)** : Peut-on identifier et contacter un décideur ? Nom du DRH connu = 25, poste identifié = 15, rien = 5
- **Fraîcheur (0-20)** : < 3 jours = 20, < 7 jours = 15, < 14 jours = 10, > 14 jours = 5
- **Fiabilité source (0-15)** : Les Echos/Le Monde/LinkedIn = 15, presse spécialisée = 10, blog/communiqué = 5, source inconnue = 2
- **Force du signal (0-15)** : Levée > 10M€ / nomination C-level = 15, levée < 10M€ / recrutement cadre = 10, recrutement standard = 5

Utilise l'outil score_signals pour retourner les signaux analysés.
Si aucun signal pertinent n'est trouvé dans les articles, retourne un tableau vide.`;

// ── Tavily search queries ────────────────────────────────────────────────────

// Scan GLOBAL (tout le marché FR) — levées de fonds, restructurations, expansions
export const GLOBAL_SCAN_QUERIES = [
  "levée de fonds startup PME France 2026",
  "restructuration transformation organisationnelle France",
  "expansion internationale entreprises françaises 2026",
  "acquisition fusion PME ETI France 2026",
  "startup série A B C France 2026 levée",
  "scale-up croissance rapide effectifs France 2026",
];

// Queries CIBLÉES par entreprise — changements de poste + LinkedIn L&D
// Ces queries sont générées dynamiquement dans le scan pour chaque entreprise cible
export function buildTargetedQueries(company: string, roles: string[], _keywords?: string[]): string[] {
  const rolesSample = roles.slice(0, 4).join(" ");
  return [
    `"${company}" nomination nommé ${rolesSample}`,
    `"${company}" nouveau DRH "VP People" "Head of L&D" rejoint`,
  ];
  // Note: on utilise 2 requêtes par entreprise (pas 4) pour limiter le coût Tavily
  // Les requêtes site:linkedin.com ne fonctionnent PAS via Tavily
}

// Legacy: toutes les queries combinées (pour rétrocompat)
export const MARKET_SCAN_QUERIES = GLOBAL_SCAN_QUERIES;

// ── Deduplication helpers ───────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 3));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  return intersection / Math.min(wordsA.size, wordsB.size);
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

export function deduplicateResults(results: TavilyResult[]): TavilyResult[] {
  const seen = new Set<string>();
  const seenTitles: string[] = [];
  const unique: TavilyResult[] = [];

  for (const r of results) {
    // Skip by URL
    if (seen.has(r.url)) continue;
    seen.add(r.url);

    // Skip by title similarity
    const norm = normalizeTitle(r.title);
    if (seenTitles.some((t) => titleOverlap(norm, t) > 0.7)) continue;
    seenTitles.push(norm);

    unique.push(r);
  }

  return unique;
}

// ── Domain extractor ────────────────────────────────────────────────────────

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}
