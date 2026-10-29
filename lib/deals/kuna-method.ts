// Méthode de qualification du deck "Deal Strategy Coachello" (KUNA, buying
// committee), en texte de prompt. Partagée par le scoring (lib/deal-scoring.ts)
// et le brief du chat coach (lib/deals/coach-brief.ts) : une seule définition
// des statuts K/U/N/A et des rôles, pour que le chat raisonne comme le scoring.

export const KUNA_METHOD_PROMPT = `=== QUALIFICATION KUNA (10 dimensions) ===

KUNA mesure ce que l'on SAIT réellement, pas ce que le score suppose. Pour chaque dimension, choisis UN statut :
- "K" (Known) : confirmé EXPLICITEMENT par le prospect dans un échange daté (email, call, meeting, Claap). Source obligatoire. Sans source datée, jamais "K".
- "A" (Assumption) : ce qu'on croit vrai sans confirmation du prospect. Exemples : montant saisi par l'AE dans le CRM, champ CRM non corroboré, enthousiasme interprété comme du pouvoir de décision, concurrent "juste en benchmark" sans l'avoir demandé, budget supposé parce qu'on a demandé un devis.
- "N" (Need to know) : inconnu CRITIQUE qui bloque l'avancée au stage actuel (ex. budget, date ou EB inconnus alors qu'une proposition est envoyée).
- "U" (Unknown) : inconnu, mais pas encore bloquant à ce stage.
IMPORTANT : les planchers "STAGES AVANCÉS" valent pour le SCORE uniquement. Ne déduis JAMAIS un "K" du stage : stage avancé sans preuve = "A".
Règles strictes :
- economic_buyer = "K" UNIQUEMENT si la personne qui signe est identifiée avec certitude ET a été rencontrée (call/meeting). "Signature probable", "décideur supposé" ou redirection vers quelqu'un d'autre = "A" ou "N". Doit être cohérent avec committee : l'economic_buyer du committee a alors le status "talked".
- champion = "K" UNIQUEMENT si sa force a été testée (il a déjà obtenu un accès à l'EB ou fait avancer la décision). Enthousiaste mais jamais testé = "A".

Dimensions (clé : définition) :
- budget : ligne budgétaire confirmée ET montant
- decision_date : date de décision ou de déploiement donnée par le prospect
- economic_buyer : la personne qui signe et débloque le budget, identifiée ET rencontrée
- champion : force du champion (peut-il organiser un call avec l'EB ?)
- approval_process : processus de validation interne (qui valide, qui signe, combien de niveaux)
- competition : concurrents cartographiés (pas seulement nommés : pourquoi ils regardent ailleurs)
- urgency : trigger d'urgence (pourquoi maintenant, échéance réelle)
- org_context : contexte organisationnel (réorg, nouveau DRH, fusion, plan social…)
- target_population : population cible définie (qui, combien, quel objectif)
- exec_sponsor : sponsor exécutif (quelqu'un au CODIR/COMEX qui a mis le sujet à l'agenda)`;

export const COMMITTEE_METHOD_PROMPT = `=== BUYING COMMITTEE (5 rôles) ===
Cartographie à partir des contacts ET des personnes citées dans les échanges :
- economic_buyer : signe et débloque le budget (DRH groupe, CEO, CFO, DG BU…)
- champion : allié interne qui porte le dossier
- influencer : ne décide pas mais peut bloquer ou accélérer
- end_user : utilisateurs finaux (managers, collaborateurs coachés)
- gatekeeper : filtre l'accès à l'EB (assistante, achats, chef de projet…)
status : "talked" = vraie conversation (call, meeting, réponse email) ; "known" = identifié (nom) mais jamais échangé directement ; "unknown" = rôle non identifié (name null).`;
