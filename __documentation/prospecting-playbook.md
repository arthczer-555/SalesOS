# Playbook prospection en séquence (synthèse de recherche, octobre 2026)

Document interne : ce qui marche en prospection outbound B2B par séquences, et
comment ces règles sont câblées dans Prospecting v2 (prompts IA, linter, score
"Sequence health", templates, réglages par défaut). Version produit (anglais) :
`lib/prospecting/best-practices.ts`, affichée dans Prospecting > Playbook > Best practices.

## 1. Les chiffres qui comptent

| Sujet | Donnée | Source |
|---|---|---|
| Taux de réponse moyen | 3 à 5 % en B2B (3,43 % sur Instantly), top 10 % au-dessus de 10,7 % | Instantly Benchmark 2026 |
| Répartition des réponses | 58 % viennent du 1er email, 42 % des relances | Instantly 2026, lemlist |
| Longueur de séquence | 4 à 7 touches (jusqu'à 9), sur 10 à 25 jours ; au-delà de 9, les désinscriptions dépassent les nouvelles réponses | lemlist (millions de campagnes) |
| Cumul | 1 email : ~4,5 % ; séquence de 10 touches : jusqu'à ~22 % cumulés | lemlist |
| Cadence | J0, puis +2 à 3 j, +4, +4, puis 5 j et plus ; la cadence 3-7-7 capte 93 % des réponses à J10 | lemlist, The Digital Bloom |
| Relance en thread | Une relance formulée comme une réponse dans le même thread : ~+30 % | Instantly 2026 |
| Longueur | Moins de 80 mots (1er email 50 à 120 max), relances plus courtes | Instantly 2026 |
| Accroches | Timeline / cas comparable 10 % de réponse, chiffres 8,6 %, social proof 6,5 %, problème générique 4,4 % | The Digital Bloom |
| Personnalisation | Recherche réelle : +52 % ; simples variables prénom/entreprise : +20 à 25 % | The Digital Bloom |
| Cohortes | Campagnes de 50 personnes ou moins : x2,76 vs envois de 1 000+ | The Digital Bloom |
| Multicanal | 2 à 3 canaux (email + LinkedIn d'abord) ; touche LinkedIn 1 à 2 j après l'email, appel vers J5 à J8 ; 8 à 12 touches sur 17 à 21 j pour les cadences complètes | Apollo insights, Vida, Trellus |
| Jours | Mercredi meilleur jour de réponse, lundi pour lancer, vendredi = pic d'auto-réponses | Instantly 2026 |
| Délivrabilité | Bounce < 2 %, volume quotidien régulier, warm-up 4 à 6 semaines en partant de 5 à 10/jour, SPF / DKIM / DMARC obligatoires (règles bulk-sender Microsoft depuis mi-2025) | Instantly 2026 |

## 2. Spécificités Heads of Sales (offre AI roleplay)

- Persona le plus sollicité : 6,6 % de réponse moyenne, en dessous des C-levels (~7,6 %). Il faut être très spécifique (leur recrutement, leur ramp, leur quota), jamais générique. (The Digital Bloom)
- Pains sourcés utilisables comme insights :
  - quota attainment moyen tombé à ~43 % en 2025 (52 % en 2024) (Hyperbound) ;
  - les managers sont censés coacher 50 % de leur temps mais y passent moins de 18 % (Kurlan & Associates / Objective Management Group) ;
  - un coaching efficace fait gagner ~10,6 points d'atteinte de quota et ~6,6 points de win rate (CSO Insights).
- Signal fort : l'entreprise recrute des AE / SDR / BDR (onboarding à accélérer). Récupéré via les offres d'emploi LinkedIn (Bright Data) dans la recherche entreprise.
- Concurrents directs sur l'AI roleplay : Hyperbound (roleplays générés depuis l'ICP, scoring d'appels), Second Nature (avatars, certifications). Angle Coachello : roleplays sur l'ICP et les objections réelles + coaching humain des managers sales, dans Teams/Slack.
- Les chiffres d'impact Coachello (clients, résultats) doivent venir de Notion > Client case studies (extended library), jamais de mémoire.

## 3. Règles câblées dans le produit

| Règle | Où |
|---|---|
| 4 à 9 étapes, 7 à 20 jours d'envoi, 2 jours mini entre deux emails, 1re relance en thread, angle différent à chaque email, break-up final, au moins une touche LinkedIn, pas d'envoi vendredi/week-end | `lintSequence` (score Sequence health) |
| 1er email 50 à 120 mots, relances < 90, sujet < 60 caractères sans "!" ni majuscules, pas de lien dans le 1er email, un seul CTA, pas de "just checking in" ni de mots spam, aucune variable non résolue (bloquant), invitation LinkedIn <= 300 (bloquant) / 200 caractères | `lintMessage` |
| Prompts : problème avant solution, Coachello en une phrase, preuves uniquement issues du persona / roster / recherche, langue du prospect, aucun tiret long | `BEST_PRACTICES_PROMPT`, `lib/prospecting/ai/prompt.ts` |
| Fenêtre par défaut lun-jeu 08:30-17:30 Europe/Paris, 15 nouveaux prospects/jour, 30 emails/jour par campagne, 30/jour par boîte (max 100 en dur), envois étalés sur la journée, 1 premier contact par entreprise et par jour | `DEFAULT_SETTINGS`, moteur (`lib/prospecting/engine`) |
| Pas de tracking d'ouverture (nuit à la délivrabilité, faussé par Apple Mail Privacy Protection) : le KPI est le taux de réponse | Report, README |
| Arrêt automatique sur réponse (et sur réponse d'un collègue du même domaine), pause sur absence, suppression sur bounce dur / désinscription, bounce guard > 3 % sur 7 jours | moteur (détection par en-têtes, aucune IA ; toute réponse = arrêt + DM Slack) |
| Templates : "Sales leaders, AI roleplay" (8 touches sur ~3 semaines), "HR & L&D" (7 touches sur ~3 semaines), "Re-engage", "Quick 3-email test". Les délais se comptent en jours d'envoi (lun-jeu par défaut) | `lib/prospecting/templates.ts` |

## 4. Recommandations hors produit

- **Domaine d'envoi secondaire** (ex. un domaine dérivé de coachello) avec SPF, DKIM, DMARC et 2 à 4 semaines de warm-up : le cold email depuis les boîtes coachello.io principales expose la réputation du domaine qui porte aussi les emails clients. Prospecting supporte une boîte dédiée (Settings > "Use a dedicated mailbox").
- Google Postmaster Tools sur le domaine d'envoi.
- Petites cohortes par persona et par signal, tests A/B manuels en dupliquant une campagne (une variable à la fois).

## Sources

- lemlist, How many cold email follow-ups : https://www.lemlist.com/blog/how-many-cold-email-follow-ups
- lemlist, conditions de séquence : https://help.lemlist.com/en/articles/8290177-how-to-use-conditions-in-your-campaign-sequence
- Instantly, Cold Email Benchmark Report 2026 : https://instantly.ai/cold-email-benchmark-report-2026
- The Digital Bloom, Cold outbound reply-rate benchmarks : https://thedigitalbloom.com/learn/cold-outbound-reply-rate-benchmarks/
- Apollo, mix email / phone / LinkedIn : https://apollo.io/insights/whats-the-right-mix-of-email-phone-and-linkedin-touches-for-a-mid-market-outbound-sequence
- Vida, outbound sales cadence : https://web.vida.io/blog/best-outbound-sales-cadence
- Hyperbound, B2B quota attainment decline : https://www.hyperbound.ai/blog/b2b-sales-quota-attainment-decline
- Kurlan & Associates, sales coaching data : https://www.kurlanassociates.com/understanding-the-sales-force/2018/latest-data-on-sales-coaching-is-worse-than-pathetic/
- Apollo API, People Search / Bulk People Enrichment : https://docs.apollo.io/reference/bulk-people-enrichment
- Gmail threading (In-Reply-To / References) : https://developer.nylas.com/docs/cookbook/email/email-threading-explained/
