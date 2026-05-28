import type Anthropic from "@anthropic-ai/sdk";

// System prompt utilisé pour extraire les 6 sections de fields à partir du
// contexte deal HubSpot + transcripts Claap. Règles clés :
// - JAMAIS halluciner : si l'info n'est pas dans le contexte, laisser
//   value=null et confidence=0. Le CS lira la confiance avant d'agir.
// - Toujours citer la source via `source` (format "hubspot:<entity>:<id>" ou
//   "claap:<recordingId>" ou "inferred"). C'est utilisé par l'UI pour
//   linker vers la note/meeting d'origine.
// - Confidence calibrée : 0.9+ = info littéralement écrite, 0.6-0.8 = info
//   forte mais reformulée, 0.3-0.5 = inférée de signaux indirects.

export const CLIENT_EXTRACTION_SYSTEM_PROMPT = `Tu es un analyste Customer Success chez Coachello (coaching pour leaders/managers).
Tu reçois tout l'historique d'un deal venant de passer en closed-won : contexte HubSpot
(deal, contacts, company, notes, emails, meetings) + transcripts Claap des meetings sales.

Ton job : remplir 6 sections de fiche client en t'appuyant UNIQUEMENT sur ce contexte.

Règles ABSOLUES :
- Ne JAMAIS inventer. Si tu n'as aucun signal pour un field, value=null et confidence=0.
- Toujours citer la source du field via "source" :
  - "hubspot:note:<id>" / "hubspot:email:<id>" / "hubspot:meeting:<id>" si l'info vient
    d'un engagement HubSpot dont tu peux identifier l'id (ils sont fournis entre crochets
    dans le contexte).
  - "claap:<recordingId>" si l'info vient d'un transcript ou recap de meeting Claap.
  - "hubspot:deal:<dealId>" pour les properties du deal lui-même.
  - "hubspot:company:<companyId>" pour les properties de la company.
  - "inferred" si tu déduis le field à partir de plusieurs signaux indirects (typiquement
    avec une confidence ≤ 0.5).
- Confidence calibrée :
  - 0.9..1.0 : info littéralement écrite dans une source citée.
  - 0.6..0.8 : info forte, reformulée ou répartie sur plusieurs sources cohérentes.
  - 0.3..0.5 : inférée à partir d'indices indirects, ou unique source douteuse.
  - 0.0..0.2 : tu hésites fortement ou tu n'as rien trouvé (préfère 0 + value=null).
- LANGUE DES VALEURS : écris le contenu de chaque field (value) dans la langue du client.
  Si le contexte (transcripts, emails, notes) contient le moindre passage significatif en
  anglais, écris TOUTES les valeurs en anglais. Sinon écris en français. Ne traduis jamais
  les noms propres (entreprises, personnes, produits).

Sections à remplir :
1. general_info : qui est le client (entreprise, signataire, RH principal et opérationnel,
   parties prenantes additionnelles, langues, zones géographiques).
2. program_scope : périmètre du programme acheté (type coaching, nom du programme,
   population, nb coachés estimé, format cohortes, options activées comme auto-assessment,
   flash feedback, tripartite, quadripartite, offres associées).
3. goals : objectifs business/RH du client, KPIs visés, attentes spécifiques exprimées.
4. org : intégration IT (SSO, SIRH, Slack...), référentiels/documents partagés (avec
   liens si dispo), contraintes organisationnelles (zones horaires, validation interne...).
5. history : relation commerciale (nouveau / renouvellement / upsell), initiatives RH
   parallèles, points de vigilance détectés pendant le deal.
6. planning : date de kickoff envisagée, suivi CS attendu (QBR, adoption call M+1...),
   engagements pris par le sales pendant le deal (promesses contractuelles ou non).

Tu réponds UNIQUEMENT via l'outil client_fields.`;

// Tool definition. On a fait le choix de garder une **forme à plat par
// field** (value, confidence, source string) et de wrapper en
// ClientFieldValue côté parsing — pour deux raisons :
// 1. JSON Schema imbriqué profond casse parfois Sonnet quand on a 30 fields.
// 2. La source est un string libre ici (format documenté dans le prompt),
//    qu'on parse en ClientFieldSource structuré dans parse-claude-output.ts.
//    Plus tolérant que d'exiger un objet à 3 champs à chaque field.

type FieldSpec = { type: string; nullable?: boolean; description?: string; items?: unknown };

function field(spec: FieldSpec) {
  // Schéma générique d'un field : value (typage variable), confidence 0..1, source string.
  const valueSchema: Record<string, unknown> = { description: spec.description };
  if (spec.type === "string") valueSchema.type = ["string", "null"];
  else if (spec.type === "number") valueSchema.type = ["number", "null"];
  else if (spec.type === "boolean") valueSchema.type = ["boolean", "null"];
  else if (spec.type === "array_string") {
    valueSchema.type = ["array", "null"];
    valueSchema.items = { type: "string" };
  } else if (spec.type === "array_contact") {
    valueSchema.type = ["array", "null"];
    valueSchema.items = {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: ["string", "null"] },
        role: { type: ["string", "null"] },
      },
      required: ["name"],
    };
  } else if (spec.type === "array_doc") {
    valueSchema.type = ["array", "null"];
    valueSchema.items = {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: ["string", "null"] },
      },
      required: ["title"],
    };
  } else if (spec.type === "contact") {
    valueSchema.type = ["object", "null"];
    valueSchema.properties = {
      name: { type: "string" },
      email: { type: ["string", "null"] },
      role: { type: ["string", "null"] },
    };
    valueSchema.required = ["name"];
  } else if (spec.type === "bool_with_details") {
    valueSchema.type = ["object", "null"];
    valueSchema.properties = {
      enabled: { type: "boolean" },
      details: { type: ["string", "null"] },
    };
    valueSchema.required = ["enabled"];
  } else if (spec.type === "date") {
    valueSchema.type = ["string", "null"];
    valueSchema.description = (spec.description ?? "") + " (format ISO YYYY-MM-DD)";
  } else if (spec.type === "enum_type_coaching") {
    valueSchema.type = ["string", "null"];
    valueSchema.enum = ["humain", "ia", "hybride", null];
  } else if (spec.type === "enum_relation") {
    valueSchema.type = ["string", "null"];
    valueSchema.enum = ["nouveau", "renouvellement", "upsell", null];
  }

  return {
    type: "object",
    properties: {
      value: valueSchema,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source: {
        type: "string",
        description:
          "Format: hubspot:note:<id> | hubspot:email:<id> | hubspot:meeting:<id> | hubspot:call:<id> | hubspot:deal:<id> | hubspot:company:<id> | claap:<recordingId> | inferred | empty (si value=null)",
      },
    },
    required: ["value", "confidence", "source"],
  };
}

export const CLIENT_FIELDS_TOOL: Anthropic.Tool = {
  name: "client_fields",
  description:
    "Remplit les 6 sections de la fiche client. Pour chaque field : value (ou null), confidence 0..1, source citée.",
  input_schema: {
    type: "object",
    properties: {
      general_info: {
        type: "object",
        properties: {
          entreprise_compte: field({ type: "string", description: "Nom officiel du compte client (peut différer du nom HubSpot company)" }),
          contact_signataire: field({ type: "contact", description: "Personne ayant signé le contrat" }),
          contact_principal_rh: field({ type: "contact", description: "Référent RH principal côté client" }),
          contact_rh_operationnel: field({ type: "contact", description: "Contact opérationnel RH (différent du signataire ou décideur)" }),
          autres_parties_prenantes: field({ type: "array_contact", description: "Autres décideurs / sponsors mentionnés" }),
          langues_requises: field({ type: "array_string", description: "Langues nécessaires pour le coaching (FR, EN, ES…)" }),
          zones_geographiques: field({ type: "array_string", description: "Pays / zones où des bénéficiaires sont attendus" }),
        },
        required: [
          "entreprise_compte", "contact_signataire", "contact_principal_rh",
          "contact_rh_operationnel", "autres_parties_prenantes",
          "langues_requises", "zones_geographiques",
        ],
      },
      program_scope: {
        type: "object",
        properties: {
          type_coaching: field({ type: "enum_type_coaching", description: "humain (1:1 humain), ia (Coachello GPT), hybride" }),
          nom_programme: field({ type: "string" }),
          population_accompagnee: field({ type: "string", description: "Qui est coaché : managers, leaders, équipe RH, dirigeants…" }),
          nb_coaches_estime: field({ type: "number", description: "Nombre estimé de bénéficiaires sur la durée du contrat" }),
          cohortes_format: field({ type: "string", description: "Cohortes vs no-cohortes, durée, fréquence des sessions" }),
          auto_assessment: field({ type: "bool_with_details" }),
          flash_feedback: field({ type: "bool_with_details" }),
          tripartite: field({ type: "bool_with_details", description: "Manager + coach + coaché" }),
          quadripartite: field({ type: "bool_with_details", description: "RH + manager + coach + coaché" }),
          offres_associees: field({ type: "array_string", description: "Workshops, peer coaching, contenus annexes" }),
        },
        required: [
          "type_coaching", "nom_programme", "population_accompagnee", "nb_coaches_estime",
          "cohortes_format", "auto_assessment", "flash_feedback", "tripartite",
          "quadripartite", "offres_associees",
        ],
      },
      goals: {
        type: "object",
        properties: {
          objectifs_business_rh: field({ type: "array_string", description: "Objectifs concrets visés (ex: réduire turnover managers, accélérer onboarding leaders)" }),
          kpis_cles: field({ type: "array_string", description: "Indicateurs visés mesurables" }),
          attentes_specifiques: field({ type: "string" }),
        },
        required: ["objectifs_business_rh", "kpis_cles", "attentes_specifiques"],
      },
      org: {
        type: "object",
        properties: {
          integration_it: field({ type: "string", description: "SSO, SIRH, Slack, Teams, autres systèmes à intégrer" }),
          referentiels_documents: field({ type: "array_doc", description: "Drives, slides, leadership models partagés par le client" }),
          contraintes_organisationnelles: field({ type: "string", description: "Validation comex requise, fuseaux horaires, etc." }),
        },
        required: ["integration_it", "referentiels_documents", "contraintes_organisationnelles"],
      },
      history: {
        type: "object",
        properties: {
          relation_commerciale: field({ type: "enum_relation" }),
          initiatives_rh_paralleles: field({ type: "string", description: "Autres programmes RH déjà en place chez le client" }),
          points_de_vigilance: field({ type: "array_string", description: "Risques d'onboarding repérés dans le deal (champion fragile, budget tendu, scope flou…)" }),
        },
        required: ["relation_commerciale", "initiatives_rh_paralleles", "points_de_vigilance"],
      },
      planning: {
        type: "object",
        properties: {
          kickoff_envisage_le: field({ type: "date" }),
          suivi_cs_attendu: field({ type: "array_string", description: "Cadence CS attendue (ex: 1 mois adoption call, QBR T+3 mois)" }),
          engagements_sales: field({ type: "array_string", description: "Promesses faites par le sales pendant le deal — à vérifier par le CS" }),
        },
        required: ["kickoff_envisage_le", "suivi_cs_attendu", "engagements_sales"],
      },
    },
    required: ["general_info", "program_scope", "goals", "org", "history", "planning"],
  },
};

// Sonnet 4.6 pour l'extraction des 30 fields : Haiku 4.5 ignorait le schéma
// imbriqué et ne renvoyait que la section general_info (les `required` du tool
// ne sont pas imposés par l'API). Sonnet honore les 6 sections. Le brief et le
// recap restent sur Haiku (cf. coach-brief.ts / deal-recap.ts), ils marchent
// bien et ça limite le surcoût au seul appel qui en a besoin.
export const CLIENT_EXTRACTION_MODEL = "claude-sonnet-4-6";
