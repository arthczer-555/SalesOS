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
Ton objectif : produire un debrief structuré, actionnable, honnête et factuel, basé uniquement sur ce qui est réellement dit dans la transcription, enrichi du contexte du deal HubSpot quand il est fourni.

Règles absolues :
- Ne jamais inventer. Si une information n'est pas dans la transcription ou dans le contexte deal, ne la cite pas.
- Pour chaque axe noté, cite dans "evidence" un extrait court (≤ 15 mots) ou une paraphrase précise tirée du transcript.
- Dans "explanation" : 3-5 phrases qui expliquent POURQUOI cette note, ce qui a été fait ou raté précisément.
- Dans "recommendation" : 1 action concrète et spécifique à mener au prochain call/message sur CET axe. Pas des banalités.
- Sois juste, pas dur. Un meeting solide et professionnel mérite 7 ou 8, ne réserve pas le 7 à la perfection. Le 9/10 reste pour l'exemplaire.
- "notes" : 1-2 phrases qualitatives synthétiques, 25 mots maximum.
- "score" : de 0 à 10.

## Règle de ponctuation (NON NÉGOCIABLE)

N'utilise JAMAIS le tiret long (\`—\`, em dash) dans aucun champ produit. Cette règle s'applique à TOUS les champs (\`summary\`, \`notes\`, \`evidence\`, \`explanation\`, \`recommendation\`, \`strengths\`, \`weaknesses\`, \`coaching_priorities\`, \`risks\`, \`meeting_kind_reasoning\`, labels et quotes de \`key_moments\`). Remplace systématiquement par virgule, point, deux-points, ou tiret court (\`-\`).

## Forme attendue des champs synthèse (rendus en Slack au commercial)

- \`strengths\` et \`weaknesses\` : chaque entrée est un fragment court, 6 à 15 mots. Verbe ou nom + objet précis. Bon : "Pas de challenge sur le budget". Mauvais : "Discovery faible sur le budget car le sales n'a pas creusé".
- \`coaching_priorities\` : chaque action est UNE phrase de 15 à 25 mots. Format \`verbe à l'infinitif + objet précis + cible ou pourquoi\`. Une seule idée par bullet. Interdit : énumérations inline \`(1)... (2)...\`, deux actions empilées avec "et", justification post-bullet à rallonge.
- \`summary\` : 2 à 3 phrases courtes, scannables en 10 secondes. Pas d'énumérations inline.

## Échelle de notation calibrée (à appliquer partout : axes coaching, MEDDIC, BOSCHE)

- **0-2** : absent ou raté, la dimension n'a pas été abordée, ou de façon contre-productive.
- **3-4** : effleuré, survolé sans profondeur, opportunité manquée.
- **5-6** : fait mais incomplet, couvert correctement, manque de la profondeur ou de la rigueur.
- **7-8** : solide, bien exécuté, attendu d'un commercial expérimenté. C'est la zone par défaut d'un meeting standard sans grosse faute.
- **9-10** : exemplaire, exécution remarquable, à montrer en exemple.

Point d'ancrage : un meeting "normal et propre" sans erreur majeure se note **6-7**, pas 4-5. Ne descends sous 5 que s'il y a un vrai problème factuel sur la dimension.

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

## 2. Grille MEDDIC (TOUJOURS remplie, framework universel de qualification)

Pour CHAQUE dimension, évalue ce qui a été fait pendant CE meeting. Si la dimension n'est pas naturellement observable pour ce type de meeting (ex : Economic Buyer en kickoff, Decision Process en discovery R1 très exploratoire, Champion avant le 2e call), préfère marquer N/A plutôt que pénaliser : mets score=0, notes="N/A, non observable en {meeting_kind}", et rends quand même une "recommendation" pour la couvrir au prochain touchpoint. N'attribue un score bas (1-3) que si la dimension *aurait dû* être travaillée à ce stade et ne l'a pas été.

- **M, Metrics** : le commercial a-t-il fait émerger des KPIs quantifiables (rétention, mobilité interne, manager effectiveness, ROI coaching) ? A-t-il proposé un cadre ROI (% promotions internes, coût hiring évité, time-to-productivity managers) ?
- **EB, Economic Buyer** : le budget holder est-il identifié ou rencontré ? Si absent, une demande d'introduction a-t-elle été formulée ?
- **DC, Decision Criteria** : les critères de sélection du prospect sont-ils compris (scalabilité, AI personalization, intégration SIRH, tracking, coaching humain vs IA) ? Coachello est-il positionné explicitement sur ces critères ?
- **DP, Decision Process** : les étapes internes d'achat + stakeholders (IT/sécurité, légal, finance, DRH, Comex) + blocages potentiels sont-ils cartographiés ?
- **IP, Identify Pain** : une vraie douleur opérationnelle est-elle isolée (scale coaching, feedback managers, leadership readiness, mesure d'impact) ? Le prospect a-t-il verbalisé les conséquences ?
- **C, Champion** : un relais interne est-il identifié et armé (case studies, business case, présentation interne) ? Est-il prêt à pousser en interne ?

## 3. Grille BOSCHE (UNIQUEMENT si meeting_kind ∈ {discovery_r1, discovery_deeper})

Si le meeting n'est PAS une discovery : mets chaque score BOSCHE à 0, notes="N/A, meeting non discovery", recommendation="" (ou une reco générique pour la prochaine discovery), trigger_identified=null, exit_criteria_met=false.

Si c'est une discovery, évalue chaque dimension avec score + notes + recommendation (1 action concrète et spécifique à mener au prochain call sur cette dimension précise) :
- **B, Business pressure** : le commercial a-t-il fait émerger l'enjeu business prioritaire et la pression associée ?
- **O, Organizational friction** : a-t-il compris qui porte le sujet, où ça bloque en interne, les silos éventuels ?
- **S, Skills gap** : les vrais blocages humains / compétences / postures sont-ils identifiés avec des exemples concrets ?
- **C, Consequences** : a-t-il fait formuler par le prospect les conséquences de l'inaction ?
- **H.E, Human & Economic impact** : le coût réel (temps, turnover, CA, engagement) est-il exprimé par le prospect lui-même ?

**trigger_identified** : détecte quel trigger Coachello ressort du call. Valeurs possibles :
- "Leadership Transitions" (ramp-up, promotions, mobilités internes)
- "Talent Pipeline" (succession, HiPos, diversité, women leadership)
- "Execution Pressure" (middle managers, feedback, accountability)
- "Strategic Transformation" (changement, IA, digital, adoption)
- "Executive Complexity" (alignement Comex, board, décisions)
- null (aucun trigger clair)

**exit_criteria_met** : true uniquement si : (a) au moins 2 implications négatives (Human Economics) explicitement formulées par le prospect, ET (b) le prospect a lui-même verbalisé un besoin d'accompagnement.

## 4. coaching_priorities

Top 3 actions ultra-concrètes à faire différemment ou en plus au prochain call. Pas des banalités, des choses précises tirées de ce qui a manqué ici. Respecte le format défini plus haut (1 phrase, 15 à 25 mots, verbe à l'infinitif + objet + cible).

## 5. summary

2-3 phrases : ce qui a été bien fait + le principal point à travailler.

## 6. strengths / weaknesses (récap exécutif)

- **strengths** : 3 points où le commercial a été bon, formulés courts (ex : "Opening structuré, agenda clair en 30s").
- **weaknesses** : 3 points à travailler, formulés courts et précis (pas "discovery faible" mais "Pas de challenge sur le budget").

Ces deux listes alimentent un récap visuel : sois bref et concret. Respecte le format défini plus haut (6 à 15 mots, verbe ou nom + objet précis).

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
        description: "Grille MEDDIC, toujours remplie. N/A explicite si non observable.",
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
        description: "Grille BOSCHE, remplie uniquement pour les discoveries. Sinon scores à 0 et notes='N/A'.",
        properties: {
          business: {
            type: "object",
            properties: {
              score: { type: "number" },
              notes: { type: "string" },
              recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cette dimension" },
            },
            required: ["score", "notes", "recommendation"],
          },
          organization: {
            type: "object",
            properties: {
              score: { type: "number" },
              notes: { type: "string" },
              recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cette dimension" },
            },
            required: ["score", "notes", "recommendation"],
          },
          skills: {
            type: "object",
            properties: {
              score: { type: "number" },
              notes: { type: "string" },
              recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cette dimension" },
            },
            required: ["score", "notes", "recommendation"],
          },
          consequences: {
            type: "object",
            properties: {
              score: { type: "number" },
              notes: { type: "string" },
              recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cette dimension" },
            },
            required: ["score", "notes", "recommendation"],
          },
          human_economic: {
            type: "object",
            properties: {
              score: { type: "number" },
              notes: { type: "string" },
              recommendation: { type: "string", description: "1 action concrète à mener au prochain call sur cette dimension" },
            },
            required: ["score", "notes", "recommendation"],
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

export type BoscheDimension = { score: number; notes: string; recommendation: string };

export type BoscheScore = {
  business: BoscheDimension;
  organization: BoscheDimension;
  skills: BoscheDimension;
  consequences: BoscheDimension;
  human_economic: BoscheDimension;
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
 * Weighted global score (0-10).
 *
 * - Prospect (shape avec `meddic` + `bosche`) : 50% axes + 30% MEDDIC + 20%
 *   BOSCHE (si discovery ET exit_criteria_met, sinon redistribué 60/40 sur
 *   axes + MEDDIC).
 * - Client (shape avec `customer_health`) : 100% axes (moyenne des 6 axes
 *   CS). Pas de grille de qualif à pondérer.
 *
 * Defensive contre les outputs partiels du modèle.
 */
export function computeGlobalScore(analysis: Partial<AnySalesCoachAnalysis>): number {
  if (isClientAnalysis(analysis)) {
    const ax = analysis.axes;
    const scores = ax
      ? [
          safeScore(ax.opening),
          safeScore(ax.discovery),
          safeScore(ax.active_listening),
          safeScore(ax.value_reinforcement),
          safeScore(ax.expansion_discovery),
          safeScore(ax.next_steps),
        ]
      : [];
    if (scores.length === 0) return 0;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg * 10) / 10;
  }

  const prospect = analysis as Partial<SalesCoachAnalysis>;
  const axes = prospect.axes ?? null;
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

  const m = prospect.meddic ?? null;
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

  const b = prospect.bosche ?? null;
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

  const isDisco = isDiscoveryKind(prospect.meeting_kind ?? null);
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

/**
 * Walks `s` starting at index `startIdx` (must point to `[` or `{`) and returns
 * the index of the matching closing bracket, ignoring brackets inside string
 * literals. Handles both `"` and `'` as string delimiters (Haiku occasionally
 * emits JS-literal style with single-quoted strings). Returns -1 if no balanced
 * bracket is found.
 */
function findMatchingBracket(s: string, startIdx: number = 0): number {
  if (startIdx < 0 || startIdx >= s.length) return -1;
  const open = s[startIdx];
  if (open !== "[" && open !== "{") return -1;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") { escape = true; continue; }
      if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Finds `"fieldName": [...]` anywhere in `blob` and returns the array literal
 * (including the outer brackets) via bracket-balanced walk. Robust to nested
 * arrays/objects and quoted content. Returns null if not found or the array
 * isn't balanced.
 */
function extractNamedArrayLiteral(blob: string, fieldName: string): string | null {
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`"${escapedName}"\\s*:\\s*\\[`);
  const m = marker.exec(blob);
  if (!m) return null;
  const arrayStart = m.index + m[0].length - 1;
  const end = findMatchingBracket(blob, arrayStart);
  if (end < 0) return null;
  return blob.slice(arrayStart, end + 1);
}

/**
 * Recovers a string array from a named field inside a corrupted blob. Locates
 * `"fieldName": [...]` via bracket-balanced walk, then tries JSON.parse on the
 * literal. If that fails (unescaped chars, JS-literal-style content, etc.),
 * falls back to regex extraction of quoted substrings. Returns null only if
 * the field can't be located at all.
 */
function extractStringArrayFromBlob(blob: string, fieldName: string): string[] | null {
  const literal = extractNamedArrayLiteral(blob, fieldName);
  if (!literal) return null;
  try {
    const parsed = JSON.parse(literal);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch (e) {
    console.warn(`[repairAnalysis] JSON.parse failed on ${fieldName} literal (${(e as Error).message.slice(0, 80)}), falling back to regex`);
  }
  return [...literal.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
  );
}

/**
 * If `obj` is a Haiku char-by-char stringification (numeric keys 0..n-1, each
 * value is a 1-char string), reassemble the concatenation and JSON.parse it.
 * Returns the recovered object/array, or null if `obj` doesn't match the
 * pattern or the reassembled string fails to parse.
 */
function reassembleCharByCharObject(obj: unknown): unknown {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return null;
  const indices = entries.map(([k]) => Number(k));
  if (indices.some((n) => !Number.isInteger(n) || n < 0)) return null;
  const max = Math.max(...indices);
  if (max !== entries.length - 1) return null;
  const values = obj as Record<string, unknown>;
  let assembled = "";
  for (let i = 0; i <= max; i++) {
    const v = values[String(i)];
    if (typeof v !== "string") return null;
    assembled += v;
  }
  try {
    return JSON.parse(assembled);
  } catch {
    return null;
  }
}

/**
 * Recovers a string[] from a Haiku-produced string that looks like a JS/JSON
 * array literal — including chained `.concat([...])` calls and trailing JS
 * noise. Returns null if the string doesn't start with `[ "` (or `[ '`) — we
 * only treat it as encoded if it clearly opens with a quoted literal, to
 * avoid mangling legit text that happens to start with `[`.
 */
function parseArrayLiteralString(s: string): string[] | null {
  const cleaned = s.trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[;,]+\s*$/, "");
  if (!/^\[\s*["']/.test(cleaned)) return null;

  const items: string[] = [];
  let rest = cleaned;
  let matched = false;
  while (rest.startsWith("[")) {
    const end = findMatchingBracket(rest);
    if (end < 0) break;
    const slice = rest.slice(0, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) {
        for (const x of parsed) if (typeof x === "string") items.push(x);
      }
    } catch {
      const matches = [...slice.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      );
      items.push(...matches);
    }
    matched = true;
    rest = rest.slice(end + 1).trimStart();
    const concat = rest.match(/^\.concat\s*\(\s*/);
    if (concat) {
      rest = rest.slice(concat[0].length).trimStart();
      continue;
    }
    break;
  }
  if (!matched || items.length === 0) return null;
  return items;
}

/**
 * Normalizes any of the malformations Haiku produces for string-array fields:
 *   - clean array → filter strings (with per-item literal recovery)
 *   - object with numeric keys (Haiku stringifies char-by-char) → take string values
 *   - single string holding a JS/JSON array literal (with optional `.concat([...])`
 *     chains or trailing JS noise) → parse out the strings
 * Anything else returns []. Idempotent on already-clean arrays.
 */
export function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === "string") {
      const recovered = parseArrayLiteralString(value[0]);
      if (recovered) return recovered;
    }
    return value.flatMap((x) => {
      if (typeof x !== "string") return [];
      return parseArrayLiteralString(x) ?? [x];
    });
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    return parseArrayLiteralString(value) ?? [value];
  }
  return [];
}

const STRING_ARRAY_FIELDS = ["coaching_priorities", "strengths", "weaknesses", "risks"] as const;

const TOOL_INPUT_LEAK_KEYS = [
  "axes",
  "meddic",
  "bosche",
  "customer_health",
  "coaching_priorities",
  "risks",
  "strengths",
  "weaknesses",
  "key_moments",
  "meeting_kind",
  "meeting_kind_reasoning",
] as const;

const TOOL_INPUT_LEAK_RE = new RegExp(
  `"\\s*,\\s*"(?:${TOOL_INPUT_LEAK_KEYS.join("|")})"\\s*:\\s*[\\[{]`,
);

/**
 * Strips Haiku tool-input leakage from a free-text string field. Pattern:
 * the model writes the closing `"` of the string then continues as if it
 * were still emitting JSON (`", "axes": { ... }, "meddic": ...`), dumping
 * the rest of the tool input as plain text inside the string. We truncate
 * at the first leakage marker. Returns the input unchanged if no leak is
 * detected.
 */
function stripToolInputLeak(s: string): string {
  const m = TOOL_INPUT_LEAK_RE.exec(s);
  if (!m) return s;
  return s.slice(0, m.index).replace(/[\s"']+$/, "");
}

const STRUCTURED_OBJECT_FIELDS = ["axes", "meddic", "bosche", "customer_health"] as const;
const NAMED_STRING_ARRAY_FIELDS = ["strengths", "weaknesses", "risks"] as const;

/**
 * Repairs known malformed shapes Haiku 4.5 occasionally produces. Recovery is
 * per-field: each failure mode handled independently so a single broken field
 * never takes down the others. Logs every recovery action.
 *
 * Failure modes handled:
 *
 *   1. Char-by-char stringification of structured fields (axes, meddic, bosche,
 *      customer_health) into numeric-keyed objects (`{"0":"{", "1":"\n", ...}`).
 *      Reassembled by joining values 0..n then JSON.parse.
 *   2. Multi-key blob: the tool input tail (priorities + key_moments + risks +
 *      strengths + weaknesses) dumped as one giant string into
 *      coaching_priorities[0]. Each leaked field extracted independently via
 *      bracket-balanced walk + JSON.parse, with a regex fallback for content
 *      whose strings have unescaped chars.
 *   3. JS-literal-as-string: a string-array field wrapped as a one-element
 *      array containing a JS array literal, with optional `.concat([...])`
 *      chains. Handled by [[extractStringArray]].
 *   4. Tool-input leak into summary: free-text field has `", "axes": ...`
 *      appended. Handled by [[stripToolInputLeak]].
 */
export function repairAnalysis<T extends Partial<AnySalesCoachAnalysis>>(analysis: T): T {
  const result: T = { ...analysis };
  const bag = result as unknown as Record<string, unknown>;

  for (const key of STRUCTURED_OBJECT_FIELDS) {
    const reassembled = reassembleCharByCharObject(bag[key]);
    if (reassembled && typeof reassembled === "object" && !Array.isArray(reassembled)) {
      bag[key] = reassembled;
      console.log(`[repairAnalysis] reassembled char-by-char ${key}`);
    }
  }

  const cp = bag.coaching_priorities;
  const blob = Array.isArray(cp) && cp.length === 1 && typeof cp[0] === "string" ? cp[0] : null;
  const looksLikeBlob =
    !!blob &&
    blob.trimStart().startsWith("[") &&
    /"(key_moments|strengths|weaknesses|risks)"\s*:/.test(blob);

  if (blob && looksLikeBlob) {
    console.log("[repairAnalysis] multi-key blob detected, recovering each leaked field independently");

    const priorities = parseArrayLiteralString(blob);
    if (priorities && priorities.length > 0) {
      bag.coaching_priorities = priorities;
      console.log(`[repairAnalysis] recovered coaching_priorities (${priorities.length} items)`);
    }

    for (const field of NAMED_STRING_ARRAY_FIELDS) {
      const current = bag[field];
      const isMissing = !Array.isArray(current) || current.length === 0;
      if (!isMissing) continue;
      const recovered = extractStringArrayFromBlob(blob, field);
      if (recovered && recovered.length > 0) {
        bag[field] = recovered;
        console.log(`[repairAnalysis] recovered ${field} (${recovered.length} items)`);
      }
    }

    const kmExisting = bag.key_moments;
    const kmMissing = !Array.isArray(kmExisting) || kmExisting.length === 0;
    if (kmMissing) {
      const kmLiteral = extractNamedArrayLiteral(blob, "key_moments");
      if (kmLiteral) {
        try {
          const km = JSON.parse(kmLiteral);
          if (Array.isArray(km) && km.length > 0) {
            bag.key_moments = km;
            console.log(`[repairAnalysis] recovered key_moments (${km.length} items)`);
          }
        } catch (e) {
          console.warn(`[repairAnalysis] key_moments parse failed: ${(e as Error).message.slice(0, 120)}`);
        }
      }
    }
  }

  for (const key of STRING_ARRAY_FIELDS) {
    if (bag[key] === undefined) continue;
    const before = bag[key];
    const after = extractStringArray(before);
    if (!Array.isArray(before) || before.some((x) => typeof x !== "string") || before.length !== after.length) {
      console.log(`[repairAnalysis] normalized ${key} (${Array.isArray(before) ? before.length : "scalar"} -> ${after.length})`);
    }
    bag[key] = after;
  }

  for (const key of ["summary", "meeting_kind_reasoning"] as const) {
    const v = bag[key];
    if (typeof v !== "string") continue;
    const cleaned = stripToolInputLeak(v);
    if (cleaned.length !== v.length) {
      console.log(`[repairAnalysis] stripped tool-input leak from ${key} (${v.length} -> ${cleaned.length} chars)`);
      bag[key] = cleaned;
    }
  }

  return result;
}

export const PROSPECT_AXES_KEYS = [
  "opening",
  "discovery",
  "active_listening",
  "value_articulation",
  "objection_handling",
  "next_steps",
] as const;

export const CLIENT_AXES_KEYS = [
  "opening",
  "discovery",
  "active_listening",
  "value_reinforcement",
  "expansion_discovery",
  "next_steps",
] as const;

export const MEDDIC_KEYS = [
  "metrics",
  "economic_buyer",
  "decision_criteria",
  "decision_process",
  "identify_pain",
  "champion",
] as const;

export const BOSCHE_DIMENSION_KEYS = [
  "business",
  "organization",
  "skills",
  "consequences",
  "human_economic",
] as const;

/**
 * Haiku 4.5 occasionally stuffs a sub-object as a JSON string spread char-by-char
 * into a numeric-keyed object (e.g. `axes = {"0":"{", "1":"\n", "2":" ", ...}`),
 * leaving the expected named keys absent. We can't reliably re-parse that (the
 * stringified content usually has unescaped quotes) — detect it so the caller
 * can retry the model call.
 */
function hasNamedShape(obj: unknown, expectedKeys: readonly string[]): boolean {
  if (!obj || typeof obj !== "object") return false;
  return expectedKeys.every((k) => {
    const v = (obj as Record<string, unknown>)[k];
    if (!v || typeof v !== "object") return false;
    return typeof (v as { score?: unknown }).score === "number";
  });
}

export function isProspectAnalysisShapeValid(analysis: Partial<SalesCoachAnalysis>): boolean {
  if (!hasNamedShape(analysis.axes, PROSPECT_AXES_KEYS)) return false;
  if (!hasNamedShape(analysis.meddic, MEDDIC_KEYS)) return false;
  if (isDiscoveryKind(analysis.meeting_kind ?? null)) {
    if (!hasNamedShape(analysis.bosche, BOSCHE_DIMENSION_KEYS)) return false;
  }
  return true;
}

export function isClientAnalysisShapeValid(analysis: Partial<ClientSalesCoachAnalysis>): boolean {
  return hasNamedShape(analysis.axes, CLIENT_AXES_KEYS);
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

/* ─────────────────────────────────────────────────────────────────────── */
/*  Client coaching (Customer Success)                                      */
/* ─────────────────────────────────────────────────────────────────────── */

export const CLIENT_MEETING_KINDS = [
  "onboarding",
  "health_check",
  "qbr",
  "expansion_call",
  "escalation",
  "renewal_prep",
  "training",
  "other",
] as const;

export type ClientMeetingKind = (typeof CLIENT_MEETING_KINDS)[number];

export const CLIENT_MEETING_KIND_LABELS: Record<ClientMeetingKind, string> = {
  onboarding: "Onboarding",
  health_check: "Health check",
  qbr: "QBR",
  expansion_call: "Expansion call",
  escalation: "Escalation",
  renewal_prep: "Pré-renouvellement",
  training: "Formation",
  other: "Autre",
};

export type AnyMeetingKind = MeetingKind | ClientMeetingKind;

/**
 * Label humain d'un meeting_kind, prospect ou client. `MeetingKind` et
 * `ClientMeetingKind` partagent la valeur "other" mais sont disjoints sur le
 * reste, donc on cherche d'abord côté prospect puis côté client.
 */
export function getMeetingKindLabel(
  kind: AnyMeetingKind | string | null | undefined,
): string | null {
  if (!kind) return null;
  if (kind in MEETING_KIND_LABELS) return MEETING_KIND_LABELS[kind as MeetingKind];
  if (kind in CLIENT_MEETING_KIND_LABELS) return CLIENT_MEETING_KIND_LABELS[kind as ClientMeetingKind];
  return null;
}

export const CLIENT_SALES_COACH_SYSTEM_PROMPT = `Tu es un coach senior pour les équipes Customer Success de Coachello (plateforme d'AI + human coaching pour leadership, mobilité interne, management).
Tu analyses la transcription d'un meeting CLIENT (compte gagné, en passation Customer Success, ou en accompagnement post-signature) entre un AE/CSM Coachello et un compte client existant.
Ton objectif : produire un debrief CS structuré, actionnable, honnête et factuel, basé uniquement sur ce qui est réellement dit dans la transcription, enrichi du contexte du deal HubSpot quand il est fourni.

IMPORTANT : ce n'est PAS un meeting de qualification prospect. Ne cherche pas à faire émerger un budget, un decision process ou un champion comme on le ferait avec un prospect en cycle de vente. Le client a déjà acheté ; le coaching se concentre sur la valeur livrée, l'évolution des besoins, la santé de la relation et les signaux d'expansion.

Règles absolues :
- Ne jamais inventer. Si une information n'est pas dans la transcription ou dans le contexte deal, ne la cite pas.
- Pour chaque axe noté, cite dans "evidence" un extrait court (≤ 15 mots) ou une paraphrase précise tirée du transcript.
- Dans "explanation" : 3-5 phrases qui expliquent POURQUOI cette note, précisément.
- Dans "recommendation" : 1 action CS concrète et spécifique à mener au prochain touchpoint sur CET axe. Pas des banalités.
- Sois juste, pas dur. Un meeting solide et professionnel mérite 7 ou 8.
- "notes" : 1-2 phrases qualitatives synthétiques, 25 mots maximum.
- "score" : 0 à 10.

## Règle de ponctuation (NON NÉGOCIABLE)

N'utilise JAMAIS le tiret long (\`—\`, em dash) dans aucun champ produit. Cette règle s'applique à TOUS les champs (\`summary\`, \`notes\`, \`evidence\`, \`explanation\`, \`recommendation\`, \`strengths\`, \`weaknesses\`, \`coaching_priorities\`, \`risks\`, \`customer_health.*\`, \`meeting_kind_reasoning\`, labels et quotes de \`key_moments\`). Remplace systématiquement par virgule, point, deux-points, ou tiret court (\`-\`).

## Forme attendue des champs synthèse (rendus en Slack au CSM/AE)

- \`strengths\` et \`weaknesses\` : chaque entrée est un fragment court, 6 à 15 mots. Verbe ou nom + objet précis. Bon : "Rappel ROI chiffré en 30s d'ouverture". Mauvais : "Value reinforcement faible car pas de chiffres d'usage cités sur les 3 derniers mois".
- \`coaching_priorities\` : chaque action est UNE phrase de 15 à 25 mots. Format \`verbe à l'infinitif + objet précis + cible ou pourquoi\`. Une seule idée par bullet. Interdit : énumérations inline \`(1)... (2)...\`, deux actions empilées avec "et", justification post-bullet à rallonge.
- \`summary\` : 2 à 3 phrases courtes, scannables en 10 secondes. Pas d'énumérations inline.
- \`customer_health.*\` : 1 à 3 phrases courtes par dimension, 8 à 20 mots chacune. Pas d'énumérations inline \`(1)... (2)... (3)...\`. Pas de sous-listes. Si rien d'observable, mettre exactement \`Pas observable dans ce meeting\`.

## Échelle de notation calibrée (appliquer à tous les axes)

- **0-2** : absent ou raté - la dimension n'a pas été abordée, ou de façon contre-productive.
- **3-4** : effleuré - survolé sans profondeur, opportunité manquée.
- **5-6** : fait mais incomplet - couvert correctement, manque de profondeur ou de rigueur.
- **7-8** : solide - bien exécuté, attendu d'un CSM/AE expérimenté. Zone par défaut d'un meeting CS standard sans grosse faute.
- **9-10** : exemplaire - exécution remarquable, à montrer en exemple.

Point d'ancrage : un meeting CS "normal et propre" sans erreur majeure se note **6-7**, pas 4-5. Ne descends sous 5 que s'il y a un vrai problème factuel.

## 0. Classification du meeting (meeting_kind)

Détermine le type de meeting en combinant titre, contenu du transcript, stage HubSpot et historique. Valeurs possibles :

- "onboarding" : kickoff post-signature, mise en place du programme, premier touchpoint après signature.
- "health_check" : check-in régulier (mensuel ou trimestriel sans format formel QBR).
- "qbr" : Quarterly Business Review, revue formelle de valeur livrée avec stakeholders.
- "expansion_call" : discussion d'upsell, cross-sell, extension de périmètre ou de licences.
- "escalation" : résolution d'un blocage, plainte, insatisfaction, point de tension.
- "renewal_prep" : préparation au renouvellement, validation de la reconduction.
- "training" : formation produit, enablement utilisateur, accompagnement à l'usage.
- "other" : ne rentre dans aucune catégorie.

Dans "meeting_kind_reasoning" : 1 phrase qui justifie.

## 1. Grille 6 axes coaching (TOUJOURS remplie)

1. **Opening & rapport relationnel** : ouverture chaleureuse, vérification du moral du compte, contrat de meeting (objectif, durée, agenda), énergie, présence.
2. **Discovery (évolution des objectifs)** : profondeur du questionnement sur ce qui a changé depuis la dernière fois (priorités business, KPIs, équipe, contexte interne). Pas de discovery prospect classique - on creuse l'évolution.
3. **Écoute active** : reformulations, silences productifs, rebonds sur ce que dit le client, absence de monologue côté Coachello.
4. **Value reinforcement** : capacité à rappeler la valeur livrée (ROI, données d'usage, témoignages internes), à connecter le programme aux résultats observés, à matérialiser le retour sur investissement.
5. **Expansion discovery** : détection des signaux d'expansion (autres équipes intéressées, nouveaux use cases, montée en grade dans l'organisation), questions ouvertes sur les besoins adjacents. Pas d'objection handling - on cherche les ouvertures.
6. **Next steps & follow-through** : prochaine étape précise (date, participants, livrable), validation explicite côté client, engagement mutuel.

## 2. Customer Health (TOUJOURS rempli, qualitatif uniquement)

Pour chaque dimension, 1 à 3 phrases factuelles basées sur ce qui est observable dans le meeting. Pas de score. Pas de note chiffrée. Une lecture qualitative qui sert à comprendre l'état réel du compte. Si une dimension n'a aucune donnée observable, mets exactement "Pas observable dans ce meeting" - n'invente rien.

- **relationship** : santé de la relation. Champion en place ? Multi-threading sur plusieurs stakeholders ? Confiance / chaleur dans les échanges ? Tensions ou distance ?
- **adoption** : usage produit, engagement avec le programme. Le client utilise-t-il activement la plateforme ? Sessions coaching mentionnées ? Adhésion équipe ?
- **sentiment** : satisfaction implicite. Le client est-il positif, neutre, préoccupé ? Mentionne-t-il valeur, plaisir, friction, frustration ?
- **expansion_signals** : ouvertures concrètes pour upsell / cross-sell. Autres équipes mentionnées ? Nouveaux features souhaités ? Recommandations internes ? Volonté d'élargir le périmètre ?
- **risk_flags** : signaux de churn ou de désengagement. Blocages, plaintes, changement de stakeholder, baisse d'usage, frustration, sponsor qui s'éloigne, budget remis en question.

## 3. coaching_priorities

Top 3 actions ultra-concrètes pour le prochain touchpoint CS. Pas des banalités, des choses précises tirées de ce qui a manqué ici. Respecte le format défini plus haut (1 phrase, 15 à 25 mots, verbe à l'infinitif + objet + cible).

## 4. summary

2-3 phrases : ce qui a été bien fait + le principal point à travailler côté CS.

## 5. strengths / weaknesses (récap exécutif)

- **strengths** : 3 points où le CSM/AE a été bon, formulés courts (ex : "Rappel ROI chiffré en 30s d'ouverture").
- **weaknesses** : 3 points à travailler, courts et précis (pas "value reinforcement faible" mais "Pas de chiffres d'usage cités sur les 3 derniers mois").

## 6. key_moments (frise temporelle)

4 à 6 moments-pivots du meeting, chacun avec :
- **timestamp_seconds** : seconde dans le meeting (0 si inconnu).
- **kind** : engagement / objection / pivot / doubt / next_step / concession.
- **label** : 1 phrase courte qui résume le moment.
- **quote** : citation ≤15 mots du transcript.

Utilise l'outil sales_coach_client_analysis pour retourner ton analyse.`;

const customerHealthSchema = {
  type: "object" as const,
  properties: {
    relationship: { type: "string", description: "1-3 phrases sur la santé de la relation (champion, multi-threading, confiance). 'Pas observable dans ce meeting' si aucun signal." },
    adoption: { type: "string", description: "1-3 phrases sur l'usage produit / engagement avec le programme." },
    sentiment: { type: "string", description: "1-3 phrases sur la satisfaction implicite (positif/neutre/préoccupé)." },
    expansion_signals: { type: "string", description: "1-3 phrases sur les ouvertures d'expansion (autres équipes, nouveaux use cases)." },
    risk_flags: { type: "string", description: "1-3 phrases sur les signaux de churn / désengagement." },
  },
  required: ["relationship", "adoption", "sentiment", "expansion_signals", "risk_flags"],
};

export const clientSalesCoachTool: Anthropic.Tool = {
  name: "sales_coach_client_analysis",
  description: "Retourne l'analyse coaching CS structurée du meeting client",
  input_schema: {
    type: "object" as const,
    properties: {
      meeting_kind: {
        type: "string",
        enum: [...CLIENT_MEETING_KINDS],
        description: "Type de meeting client inféré",
      },
      meeting_kind_reasoning: {
        type: "string",
        description: "1 phrase qui justifie la classification",
      },
      summary: {
        type: "string",
        description: "2-3 phrases : bien fait + principal point à travailler côté CS",
      },
      axes: {
        type: "object",
        properties: {
          opening: axisSchema,
          discovery: axisSchema,
          active_listening: axisSchema,
          value_reinforcement: axisSchema,
          expansion_discovery: axisSchema,
          next_steps: axisSchema,
        },
        required: ["opening", "discovery", "active_listening", "value_reinforcement", "expansion_discovery", "next_steps"],
      },
      customer_health: customerHealthSchema,
      coaching_priorities: {
        type: "array",
        description: "Top 3 actions concrètes pour le prochain touchpoint CS",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        description: "Risques compte / churn identifiés depuis la transcription",
        items: { type: "string" },
      },
      strengths: {
        type: "array",
        description: "3 points où le CSM/AE a été bon (formulés courts)",
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
            label: { type: "string" },
            quote: { type: "string", description: "Citation ≤15 mots" },
          },
          required: ["timestamp_seconds", "kind", "label", "quote"],
        },
      },
    },
    required: ["meeting_kind", "meeting_kind_reasoning", "summary", "axes", "customer_health", "coaching_priorities", "risks", "strengths", "weaknesses", "key_moments"],
  },
};

export type CustomerHealth = {
  relationship: string;
  adoption: string;
  sentiment: string;
  expansion_signals: string;
  risk_flags: string;
};

export type ClientSalesCoachAnalysis = {
  meeting_kind: ClientMeetingKind;
  meeting_kind_reasoning: string;
  summary: string;
  axes: {
    opening: AxisScore;
    discovery: AxisScore;
    active_listening: AxisScore;
    value_reinforcement: AxisScore;
    expansion_discovery: AxisScore;
    next_steps: AxisScore;
  };
  customer_health: CustomerHealth;
  coaching_priorities: string[];
  risks: string[];
  strengths?: string[];
  weaknesses?: string[];
  key_moments?: KeyMoment[];
};

export type AnySalesCoachAnalysis = SalesCoachAnalysis | ClientSalesCoachAnalysis;

/**
 * Discrimine prospect vs client sur la shape JSONB stockée en DB. Plus fiable
 * que de se baser sur `audience` côté row : l'analyse elle-même porte sa propre
 * structure.
 */
export function isClientAnalysis(
  a: Partial<AnySalesCoachAnalysis> | null | undefined,
): a is ClientSalesCoachAnalysis {
  return !!a && typeof a === "object" && "customer_health" in a;
}
