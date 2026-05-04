import type Anthropic from "@anthropic-ai/sdk";

export const MEETING_KINDS = [
  "discovery_r1",
  "discovery_deeper",
  "demo",
  "negotiation",
  "closing",
  "follow_up",
  "kickoff",
  "other",
] as const;

export type MeetingKind = (typeof MEETING_KINDS)[number];

export const SALES_COACH_SYSTEM_PROMPT = `Tu es un coach senior pour les équipes commerciales B2B de Coachello (plateforme d'AI + human coaching pour leadership, mobilité interne, management).
Tu analyses la transcription d'un meeting de vente (discovery, démo, négociation, closing…) entre un commercial Coachello et un prospect.
Ton objectif : produire un debrief structuré, actionnable, honnête et factuel — basé uniquement sur ce qui est réellement dit dans la transcription, enrichi du contexte du deal HubSpot quand il est fourni.

Règles absolues :
- Ne jamais inventer. Si une information n'est pas dans la transcription ou dans le contexte deal, ne la cite pas.
- Pour chaque axe noté, cite dans "evidence" un extrait court (≤ 15 mots) ou une paraphrase précise tirée du transcript.
- Dans "explanation" : 3-5 phrases qui expliquent POURQUOI cette note — ce qui a été fait ou raté précisément.
- Dans "recommendation" : 1 action concrète et spécifique à mener au prochain call/message sur CET axe. Pas des banalités.
- Un mauvais score avec un feedback clair vaut mieux qu'un score flatteur.
- "notes" : 1-2 phrases qualitatives synthétiques.
- "score" : de 0 à 10.

## 0. Classification du meeting (meeting_kind)

Détermine le type de meeting en combinant :
- le titre du meeting
- le stage HubSpot du deal et son historique
- le nombre de meetings précédents déjà menés sur ce deal
- le contenu même du transcript

Valeurs possibles :
- "discovery_r1" : premier call de découverte, on apprend l'environnement du prospect.
- "discovery_deeper" : deuxième/troisième call d'approfondissement (stakeholders, besoin, budget).
- "demo" : démonstration produit / pitch solution.
- "negotiation" : négociation commerciale (prix, contrat, scope).
- "closing" : signature, engagement final, dernières objections.
- "follow_up" : point d'étape, relance, nurturing.
- "kickoff" : lancement projet post-signature.
- "other" : ne rentre dans aucune catégorie.

Dans "meeting_kind_reasoning" : 1 phrase qui justifie.

## 1. Grille 6 axes coaching (TOUJOURS remplie, tous types de meetings)

1. **Opening & first impressions** : ouverture claire, contrat initial (objectif, durée, agenda, prochaines étapes), énergie, écoute active dès le début.
2. **Discovery quality** : profondeur du questionnement, qualité des relances, exploration du contexte business, identification des enjeux réels.
3. **Active listening** : reformulations, silences productifs, rebonds sur ce que dit le prospect, absence de monologue commercial.
4. **Value articulation** : capacité à connecter Coachello aux enjeux spécifiques du prospect (pas un pitch générique), storytelling client, langage adapté au buyer.
5. **Objection handling** : accueil des objections sans défense, reformulation, réponses factuelles et concises, retour à la découverte si besoin.
6. **Next steps & closing** : prochaine étape précise (date, participants, livrable), validation explicite du prospect, engagement mutuel.

## 2. Grille MEDDIC (TOUJOURS remplie — framework universel de qualification)

Pour CHAQUE dimension, évalue ce qui a été fait pendant CE meeting. Si la dimension n'est pas observable pour ce type de meeting (ex : Economic Buyer en kickoff), mets score=0, notes="N/A — non observable en {meeting_kind}", et rends quand même une "recommendation" pour la couvrir au prochain touchpoint.

- **M — Metrics** : le commercial a-t-il fait émerger des KPIs quantifiables (rétention, mobilité interne, manager effectiveness, ROI coaching) ? A-t-il proposé un cadre ROI (% promotions internes, coût hiring évité, time-to-productivity managers) ?
- **EB — Economic Buyer** : le budget holder est-il identifié ou rencontré ? Si absent, une demande d'introduction a-t-elle été formulée ?
- **DC — Decision Criteria** : les critères de sélection du prospect sont-ils compris (scalabilité, AI personalization, intégration SIRH, tracking, coaching humain vs IA) ? Coachello est-il positionné explicitement sur ces critères ?
- **DP — Decision Process** : les étapes internes d'achat + stakeholders (IT/sécurité, légal, finance, DRH, Comex) + blocages potentiels sont-ils cartographiés ?
- **IP — Identify Pain** : une vraie douleur opérationnelle est-elle isolée (scale coaching, feedback managers, leadership readiness, mesure d'impact) ? Le prospect a-t-il verbalisé les conséquences ?
- **C — Champion** : un relais interne est-il identifié et armé (case studies, business case, présentation interne) ? Est-il prêt à pousser en interne ?

## 3. Grille BOSCHE (UNIQUEMENT si meeting_kind ∈ {discovery_r1, discovery_deeper})

Si le meeting n'est PAS une discovery : mets chaque score BOSCHE à 0, notes="N/A — meeting non discovery", trigger_identified=null, exit_criteria_met=false.

Si c'est une discovery, évalue :
- **B — Business pressure** : le commercial a-t-il fait émerger l'enjeu business prioritaire et la pression associée ?
- **O — Organizational friction** : a-t-il compris qui porte le sujet, où ça bloque en interne, les silos éventuels ?
- **S — Skills gap** : les vrais blocages humains / compétences / postures sont-ils identifiés avec des exemples concrets ?
- **C — Consequences** : a-t-il fait formuler par le prospect les conséquences de l'inaction ?
- **H.E — Human & Economic impact** : le coût réel (temps, turnover, CA, engagement) est-il exprimé par le prospect lui-même ?

**trigger_identified** : détecte quel trigger Coachello ressort du call. Valeurs possibles :
- "Leadership Transitions" (ramp-up, promotions, mobilités internes)
- "Talent Pipeline" (succession, HiPos, diversité, women leadership)
- "Execution Pressure" (middle managers, feedback, accountability)
- "Strategic Transformation" (changement, IA, digital, adoption)
- "Executive Complexity" (alignement Comex, board, décisions)
- null (aucun trigger clair)

**exit_criteria_met** : true uniquement si : (a) au moins 2 implications négatives (Human Economics) explicitement formulées par le prospect, ET (b) le prospect a lui-même verbalisé un besoin d'accompagnement.

## 4. coaching_priorities

Top 3 actions ultra-concrètes à faire différemment / en plus au prochain call. Pas des banalités — des choses précises tirées de ce qui a manqué ici.

## 5. summary

2-3 phrases : ce qui a été bien fait + le principal point à travailler.

## 6. strengths / weaknesses (récap exécutif)

- **strengths** : 3 points où le commercial a été bon — formulés courts (ex : "Opening structuré, agenda clair en 30s").
- **weaknesses** : 3 points à travailler — formulés courts et précis (pas "discovery faible" mais "Pas de challenge sur le budget").

Ces deux listes alimentent un récap visuel — sois bref et concret.

## 7. key_moments (frise temporelle)

4 à 6 moments-pivots du meeting, chacun avec :
- **timestamp_seconds** : seconde dans le meeting (depuis le début).
- **kind** : engagement / objection / pivot / doubt / next_step / concession.
- **label** : 1 phrase courte qui résume le moment.
- **quote** : citation ≤15 mots du transcript.

Si la transcription n'a pas de timestamps, mets 0 partout.

Utilise l'outil sales_coach_analysis pour retourner ton analyse.`;

const axisSchema = {
  type: "object" as const,
  properties: {
    score: { type: "number", description: "0-10" },
    notes: { type: "string", description: "1-2 phrases qualitatives synthétiques" },
    evidence: { type: "string", description: "Extrait ≤15 mots ou paraphrase précise du transcript" },
    explanation: { type: "string", description: "3-5 phrases : POURQUOI cette note, précisément" },
    recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cet axe" },
  },
  required: ["score", "notes", "evidence", "explanation", "recommendation"],
};

const meddicSchema = {
  type: "object" as const,
  properties: {
    score: { type: "number", description: "0-10 (0 si non observable dans ce meeting_kind)" },
    notes: { type: "string" },
    evidence: { type: "string", description: "Extrait ≤15 mots ou paraphrase du transcript" },
    explanation: { type: "string", description: "Ce qui a été fait/raté sur cette dimension" },
    recommendation: { type: "string", description: "Prochaine action sur cette dimension" },
  },
  required: ["score", "notes", "evidence", "explanation", "recommendation"],
};

export const salesCoachTool: Anthropic.Tool = {
  name: "sales_coach_analysis",
  description: "Retourne l'analyse coaching structurée du meeting commercial",
  input_schema: {
    type: "object" as const,
    properties: {
      meeting_kind: {
        type: "string",
        enum: [...MEETING_KINDS],
        description: "Type de meeting inféré",
      },
      meeting_kind_reasoning: {
        type: "string",
        description: "1 phrase qui justifie la classification",
      },
      summary: {
        type: "string",
        description: "2-3 phrases : ce qui a été bien fait + principal point à travailler",
      },
      axes: {
        type: "object",
        properties: {
          opening: axisSchema,
          discovery: axisSchema,
          active_listening: axisSchema,
          value_articulation: axisSchema,
          objection_handling: axisSchema,
          next_steps: axisSchema,
        },
        required: ["opening", "discovery", "active_listening", "value_articulation", "objection_handling", "next_steps"],
      },
      meddic: {
        type: "object",
        description: "Grille MEDDIC — toujours remplie, N/A explicite si non observable",
        properties: {
          metrics: meddicSchema,
          economic_buyer: meddicSchema,
          decision_criteria: meddicSchema,
          decision_process: meddicSchema,
          identify_pain: meddicSchema,
          champion: meddicSchema,
        },
        required: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion"],
      },
      bosche: {
        type: "object",
        description: "Grille BOSCHE — remplie uniquement pour les discoveries. Sinon scores à 0 et notes='N/A'.",
        properties: {
          business: {
            type: "object",
            properties: { score: { type: "number" }, notes: { type: "string" } },
            required: ["score", "notes"],
          },
          organization: {
            type: "object",
            properties: { score: { type: "number" }, notes: { type: "string" } },
            required: ["score", "notes"],
          },
          skills: {
            type: "object",
            properties: { score: { type: "number" }, notes: { type: "string" } },
            required: ["score", "notes"],
          },
          consequences: {
            type: "object",
            properties: { score: { type: "number" }, notes: { type: "string" } },
            required: ["score", "notes"],
          },
          human_economic: {
            type: "object",
            properties: { score: { type: "number" }, notes: { type: "string" } },
            required: ["score", "notes"],
          },
          trigger_identified: {
            type: "string",
            description: "Leadership Transitions | Talent Pipeline | Execution Pressure | Strategic Transformation | Executive Complexity | null",
          },
          exit_criteria_met: {
            type: "boolean",
            description: "true si ≥2 implications négatives verbalisées par le prospect ET besoin d'accompagnement exprimé",
          },
        },
        required: ["business", "organization", "skills", "consequences", "human_economic", "trigger_identified", "exit_criteria_met"],
      },
      coaching_priorities: {
        type: "array",
        description: "Top 3 actions concrètes pour le prochain call",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        description: "Risques identifiés sur le deal depuis la transcription",
        items: { type: "string" },
      },
      strengths: {
        type: "array",
        description: "3 points où le commercial a été bon (formulés courts)",
        items: { type: "string" },
      },
      weaknesses: {
        type: "array",
        description: "3 points à travailler (courts et précis)",
        items: { type: "string" },
      },
      key_moments: {
        type: "array",
        description: "4-6 moments-pivots du meeting avec timestamp",
        items: {
          type: "object",
          properties: {
            timestamp_seconds: { type: "number", description: "Seconde dans le meeting (0 si inconnu)" },
            kind: {
              type: "string",
              enum: ["engagement", "objection", "pivot", "doubt", "next_step", "concession"],
            },
            label: { type: "string", description: "1 phrase qui résume le moment" },
            quote: { type: "string", description: "Citation ≤15 mots" },
          },
          required: ["timestamp_seconds", "kind", "label", "quote"],
        },
      },
    },
    required: ["meeting_kind", "meeting_kind_reasoning", "summary", "axes", "meddic", "bosche", "coaching_priorities", "risks", "strengths", "weaknesses", "key_moments"],
  },
};

export type AxisScore = {
  score: number;
  notes: string;
  evidence: string;
  explanation: string;
  recommendation: string;
};

export type MeddicScore = AxisScore;

export type MeddicGrid = {
  metrics: MeddicScore;
  economic_buyer: MeddicScore;
  decision_criteria: MeddicScore;
  decision_process: MeddicScore;
  identify_pain: MeddicScore;
  champion: MeddicScore;
};

export type BoscheScore = {
  business: { score: number; notes: string };
  organization: { score: number; notes: string };
  skills: { score: number; notes: string };
  consequences: { score: number; notes: string };
  human_economic: { score: number; notes: string };
  trigger_identified: string | null;
  exit_criteria_met: boolean;
};

export type KeyMomentKind = "engagement" | "objection" | "pivot" | "doubt" | "next_step" | "concession";

export type KeyMoment = {
  timestamp_seconds: number;
  kind: KeyMomentKind;
  label: string;
  quote: string;
};

export type SalesCoachAnalysis = {
  meeting_kind: MeetingKind;
  meeting_kind_reasoning: string;
  summary: string;
  axes: {
    opening: AxisScore;
    discovery: AxisScore;
    active_listening: AxisScore;
    value_articulation: AxisScore;
    objection_handling: AxisScore;
    next_steps: AxisScore;
  };
  meddic: MeddicGrid;
  bosche: BoscheScore;
  coaching_priorities: string[];
  risks: string[];
  strengths?: string[];
  weaknesses?: string[];
  key_moments?: KeyMoment[];
};

export const KEY_MOMENT_LABELS: Record<KeyMomentKind, string> = {
  engagement: "Engagement",
  objection: "Objection",
  pivot: "Pivot",
  doubt: "Doute",
  next_step: "Next step",
  concession: "Concession",
};

const DISCOVERY_KINDS: MeetingKind[] = ["discovery_r1", "discovery_deeper"];

export function isDiscoveryKind(kind: MeetingKind | null | undefined): boolean {
  return kind ? DISCOVERY_KINDS.includes(kind) : false;
}

function safeScore(x: { score?: number } | undefined | null): number {
  return typeof x?.score === "number" ? x.score : 0;
}

/**
 * Weighted global score (0-10) :
 * - 6 axes coaching : 50%
 * - MEDDIC (moyenne des 6 dimensions, en ignorant les 0 marqués N/A) : 30%
 * - BOSCHE : 20% (si discovery ET exit_criteria_met, sinon redistribué 60/40 sur axes + MEDDIC)
 *
 * Defensive against partial outputs from the model (missing meddic/bosche/axis).
 */
export function computeGlobalScore(analysis: Partial<SalesCoachAnalysis>): number {
  const axes = analysis.axes ?? null;
  const axesScores = axes
    ? [
        safeScore(axes.opening),
        safeScore(axes.discovery),
        safeScore(axes.active_listening),
        safeScore(axes.value_articulation),
        safeScore(axes.objection_handling),
        safeScore(axes.next_steps),
      ]
    : [];
  const axesAvg = axesScores.length > 0 ? axesScores.reduce((a, b) => a + b, 0) / axesScores.length : 0;

  const m = analysis.meddic ?? null;
  const meddicRaw = m
    ? [
        safeScore(m.metrics),
        safeScore(m.economic_buyer),
        safeScore(m.decision_criteria),
        safeScore(m.decision_process),
        safeScore(m.identify_pain),
        safeScore(m.champion),
      ]
    : [];
  const meddicVals = meddicRaw.filter((s) => s > 0);
  const meddicAvg = meddicVals.length > 0 ? meddicVals.reduce((a, b) => a + b, 0) / meddicVals.length : 0;

  const b = analysis.bosche ?? null;
  const boscheScores = b
    ? [
        safeScore(b.business),
        safeScore(b.organization),
        safeScore(b.skills),
        safeScore(b.consequences),
        safeScore(b.human_economic),
      ]
    : [];
  const boscheAvg = boscheScores.length > 0 ? boscheScores.reduce((a, b) => a + b, 0) / boscheScores.length : 0;

  const isDisco = isDiscoveryKind(analysis.meeting_kind ?? null);
  const useBosche = isDisco && !!b?.exit_criteria_met;

  // If a grid is empty, weight redistributes across the remaining ones.
  const hasAxes = axesScores.length > 0;
  const hasMeddic = meddicVals.length > 0;
  const parts: { val: number; w: number }[] = [];
  if (hasAxes) parts.push({ val: axesAvg, w: useBosche ? 0.4 : 0.5 });
  if (hasMeddic) parts.push({ val: meddicAvg, w: useBosche ? 0.4 : 0.5 });
  if (useBosche) parts.push({ val: boscheAvg, w: 0.2 });
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  if (wSum === 0) return 0;
  const global = parts.reduce((a, p) => a + (p.val * p.w) / wSum, 0);

  return Math.round(global * 10) / 10;
}

export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  discovery_r1: "Discovery R1",
  discovery_deeper: "Discovery approfondie",
  demo: "Démo",
  negotiation: "Négociation",
  closing: "Closing",
  follow_up: "Follow-up",
  kickoff: "Kickoff",
  other: "Autre",
};
