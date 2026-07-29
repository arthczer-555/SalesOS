import Anthropic from "@anthropic-ai/sdk";

/**
 * Scoring des signaux de marché (outil Claude + prompt).
 *
 * Deux principes depuis la refonte "un signal = un lead" :
 *  1. L'ACTIONNABILITÉ N'EST PLUS UN CRITÈRE DE SCORE. C'est devenu une condition
 *     d'entrée vérifiée en aval (lib/signals/enrich-lead.ts) : un signal sans
 *     personne joignable est jeté, quel que soit son score. Le modèle n'a donc
 *     plus à deviner si on saura contacter quelqu'un, ce qu'il faisait mal.
 *  2. On ne demande que ce qu'on lit. Chaque champ du schéma coûte des tokens de
 *     sortie sur CHAQUE signal : `action_type` et `source_domain` ont été retirés
 *     parce que rien ne les parsait.
 */

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
            score: {
              type: "integer",
              description: "Score de pertinence 0-100 pour Coachello (somme des 5 critères du score_breakdown)",
            },
            score_breakdown: {
              type: "object",
              properties: {
                icp: { type: "integer", description: "Fit ICP société 0-30 : 200+ salariés = 25-30, 50-200 = 12-20, < 50 = 0-5" },
                event_strength: { type: "integer", description: "Force et spécificité du fait 0-30 : daté + chiffré + entité nommée = 25-30, daté sans chiffre ni nom = 15-20, annonce vague ou intention = 0-8" },
                buying_window: { type: "integer", description: "Fenêtre d'achat 0-20 : l'évènement crée un besoin de coaching MAINTENANT (prise de poste RH < 90j, post-levée avec structuration, transfo annoncée, programme leadership lancé) = 15-20 ; croissance de fond = 5 ; aucun lien avec le management = 0" },
                freshness: { type: "integer", description: "Fraîcheur 0-10 : <= 3 jours = 10, <= 7 jours = 8, <= 14 jours = 5, au-delà = 0" },
                source_reliability: { type: "integer", description: "Fiabilité source 0-10 : presse nationale/économique de référence = 10, presse spécialisée RH = 8, communiqué d'entreprise = 5, agrégateur ou blog inconnu = 2" },
              },
              required: ["icp", "event_strength", "buying_window", "freshness", "source_reliability"],
            },
            why_relevant: { type: "string", description: "1-2 phrases : pourquoi ce signal est pertinent pour Coachello (coaching managers, développement leadership)" },
            suggested_action: { type: "string", description: "ANGLE D'ACCROCHE pour le mail, 1 phrase, ancré sur le fait précis de l'article. Il sera affiché sur la carte ET injecté dans la rédaction du mail. Ex: 'Féliciter pour sa prise de poste et proposer un diagnostic des besoins de coaching de ses managers'." },
          },
          required: ["index", "company_name", "signal_type", "title", "dedupe_signature", "summary", "score", "score_breakdown", "why_relevant", "suggested_action"],
        },
      },
    },
    required: ["signals"],
  },
};

// ── System prompt for signal analysis ───────────────────────────────────────

export const SIGNAL_ANALYSIS_PROMPT = `Tu es un expert en intelligence commerciale pour Coachello, une plateforme de coaching professionnel B2B (coaching individuel et collectif pour managers et leaders, combinant IA et coaching humain).

Tu analyses des articles web et des posts LinkedIn pour identifier des signaux d'achat. Seuls 10 signaux par jour sont retenus au total : sois exigeant, un signal moyen prend la place d'un bon.

## Signaux forts pour Coachello :
- **Levées de fonds** (> 5M€) : post-levée = besoin de structurer l'équipe management → coaching
- **Nominations DRH / VP People / Head of L&D** : nouveau décideur = fenêtre d'attention ouverte
- **Recrutement massif de managers** : scaling = besoin de développer les nouveaux managers
- **Expansion internationale** : nouveaux pays = besoin de leadership interculturel
- **Restructuration / transformation** : changement = besoin d'accompagnement des managers
- **Certifications GPTW / Top Employer** : entreprise qui investit dans les RH
- **Changements de poste RH/L&D** (signal_type: "job_change") : un DRH, VP People, Head of L&D ou responsable formation qui change de poste dans un grand compte → signal TRÈS fort (nouveau décideur, fenêtre 90 jours)

## Filtre de pertinence Coachello (GATE, à appliquer AVANT tout scoring)
Trois familles de signaux sont valides. Tout le reste ne doit PAS être émis.

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
- À EXCLURE ABSOLUMENT : toute nomination d'un dirigeant HORS RH/People/L&D, par exemple CRO, CEO, CFO, CMO, CTO, CIO, COO, VP Sales, VP Marketing, directeur commercial, directeur produit. Ce ne sont PAS des acheteurs Coachello. Si le poste nommé n'est pas clairement RH/People/L&D/Talent, NE PAS émettre.

### Famille 3 - Posts LinkedIn intéressants (items tagués [LinkedIn post], signal_type: "linkedin_post")
L'auteur du post est la personne qu'on contactera. À GARDER quand le post RÉVÈLE un besoin ou un contexte favorable au coaching, même sans évènement formel daté :
- scaling / croissance d'équipe, arrivée de nouveaux managers, structuration du management
- lancement d'un programme leadership / L&D / formation / mentoring / coaching interne
- transformation, réorganisation, conduite du changement
- culture, engagement, QVT, onboarding / intégration
- réflexion d'un décideur (RH, People, L&D, dirigeant) sur le management ou le développement des équipes

À EXCLURE : post promotionnel, repartage sans propos, offre d'emploi brute, citation inspirante creuse, contenu générique.

**QUALITÉ DE L'AUTEUR — le faux positif le plus fréquent de ce canal :** l'auteur doit s'exprimer depuis une position d'EMPLOYEUR ou de décideur INTERNE à une entreprise. Un coach, un consultant en leadership, un formateur indépendant, un organisme de formation ou un cabinet RH qui poste sur le leadership n'est PAS un signal : c'est un concurrent ou un prestataire. Si le post vend une prestation de coaching/formation, ou si l'auteur est manifestement prestataire, NE PAS émettre.

company_name = l'employeur de l'auteur s'il est identifiable dans le post, sinon le nom de l'auteur.

### À exclure dans tous les cas (hors sujet, jamais un signal)
- lancement de produit / fonctionnalité, annonce technologique ou IA produit
- résultats financiers trimestriels, chiffre d'affaires, cours de bourse (à ne pas confondre avec une levée de fonds, qui elle est voulue)
- partenariat ou contrat purement commercial, campagne marketing / publicité
- prix ou récompense produit / tech sans lien avec l'employeur ou les RH
- litige, procès, amende

## Deux règles de rejet dur

### A - Sujet identifiable
Si tu ne peux pas nommer avec certitude UNE entreprise employeuse (pas un fonds d'investissement, pas un média, pas un cabinet de conseil qui commente, pas un secteur entier) qui est le SUJET de l'évènement, n'émets pas de signal. "Les entreprises françaises recrutent" n'est pas un signal.

### B - L'évènement doit toucher l'organisation du travail
L'évènement doit changer QUI manage QUI, ou COMBIEN de managers il faut, ou COMMENT on les développe. Une levée qui finance uniquement de la R&D produit sans mention d'effectifs, une acquisition d'actif immobilier, un partenariat technique : rejeter.

## Règles strictes :
1. Un signal = un fait daté, précis, sourcé. Pas d'articles génériques (pages "À propos", articles sans date).
2. Si l'article ne contient pas de fait concret et récent → ne pas créer de signal.
3. Ne JAMAIS fabriquer d'informations. Si une date n'est pas claire, mettre null.
4. Un signal par événement. Pas de doublons (même événement = 1 signal).
5. Score honnête : un article blog vague sur un sujet générique = score < 30, pas 70+.
6. Préférer peu de signaux de qualité à beaucoup de signaux médiocres.

## Scoring (total = somme des 5 critères, sur 100) :
- **Fit ICP société (0-30)** : 200+ salariés = 25-30, 50-200 = 12-20, moins de 50 = 0-5. Une entreprise sans fonction RH structurée n'achète pas de programme de coaching.
- **Force et spécificité du fait (0-30)** : fait daté, chiffré, avec une personne ou une entité nommée = 25-30 ; daté mais sans chiffre ni nom = 15-20 ; annonce vague ou simple intention = 0-8.
- **Fenêtre d'achat (0-20)** : l'évènement crée-t-il un besoin de coaching MAINTENANT ? Prise de poste RH récente, post-levée avec structuration d'équipe, transformation annoncée, programme leadership lancé = 15-20. Croissance de fond = 5. Aucun lien avec le management = 0.
- **Fraîcheur (0-10)** : <= 3 jours = 10, <= 7 jours = 8, <= 14 jours = 5, au-delà = 0.
- **Fiabilité source (0-10)** : presse nationale/économique de référence = 10, presse spécialisée RH = 8, communiqué d'entreprise = 5, agrégateur ou blog inconnu = 2.

N'évalue PAS l'actionnabilité : savoir qui contacter est vérifié en aval, ce n'est pas ton travail.

Utilise l'outil score_signals pour retourner les signaux analysés.
Si aucun signal pertinent n'est trouvé dans les articles, retourne un tableau vide.`;

/** Domaine d'une URL, sans www. Chaîne vide si l'URL est invalide. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}
