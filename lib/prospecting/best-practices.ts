// Synthèse de la recherche sur la prospection en séquence (benchmarks 2025-2026).
// Affichée dans Playbook > Best practices (anglais) et compressée dans le prompt
// d'écriture (BEST_PRACTICES_PROMPT). Détail et sources : __documentation/prospecting-playbook.md.

export interface BestPractice {
  id: string;
  category: "sequence" | "copy" | "targeting" | "deliverability" | "multichannel";
  title: string;
  body: string;
  stat?: string;
  sources: { label: string; url: string }[];
}

const LEMLIST_FOLLOWUPS = { label: "lemlist, cold email follow-ups data", url: "https://www.lemlist.com/blog/how-many-cold-email-follow-ups" };
const INSTANTLY_2026 = { label: "Instantly, Cold Email Benchmark 2026", url: "https://instantly.ai/cold-email-benchmark-report-2026" };
const DIGITAL_BLOOM = { label: "The Digital Bloom, reply-rate benchmarks", url: "https://thedigitalbloom.com/learn/cold-outbound-reply-rate-benchmarks/" };
const MULTICHANNEL = { label: "Apollo, email / phone / LinkedIn mix", url: "https://apollo.io/insights/whats-the-right-mix-of-email-phone-and-linkedin-touches-for-a-mid-market-outbound-sequence" };
const KURLAN = { label: "Kurlan & Associates, sales coaching data", url: "https://www.kurlanassociates.com/understanding-the-sales-force/2018/latest-data-on-sales-coaching-is-worse-than-pathetic/" };
const HYPERBOUND = { label: "Hyperbound, quota attainment decline", url: "https://www.hyperbound.ai/blog/b2b-sales-quota-attainment-decline" };

export const BEST_PRACTICES: BestPractice[] = [
  {
    id: "length",
    category: "sequence",
    title: "4 to 7 touches over 2 to 3 weeks",
    body: "58% of replies come from the first email, the other 42% from follow-ups. Stopping after one or two emails leaves almost half of the replies on the table. Beyond 9 touches, unsubscribes outweigh new replies.",
    stat: "58% / 42%",
    sources: [INSTANTLY_2026, LEMLIST_FOLLOWUPS],
  },
  {
    id: "cadence",
    category: "sequence",
    title: "Front-load, then space out",
    body: "Day 0, then +2 to 3 days, then +4, +4, then 5+ days. The 3-7-7 cadence captures 93% of replies by day 10. Each follow-up must bring a new angle: never 'just checking in'.",
    stat: "93% by day 10",
    sources: [DIGITAL_BLOOM, LEMLIST_FOLLOWUPS],
  },
  {
    id: "thread",
    category: "sequence",
    title: "First follow-up as a reply in the same thread",
    body: "Framing step 2 as a reply rather than a new email lifts replies by about 30%. Open a new thread later with a fresh subject when you change angle, and end with a short break-up email.",
    stat: "+30%",
    sources: [INSTANTLY_2026],
  },
  {
    id: "short",
    category: "copy",
    title: "Under 80 to 120 words, one ask",
    body: "Best performers keep cold emails under 80 words and follow-ups shorter. One binary call to action ('Worth a look?'), problem first, Coachello in one line.",
    stat: "< 80 words",
    sources: [INSTANTLY_2026],
  },
  {
    id: "hooks",
    category: "copy",
    title: "Timeline and numbers hooks win",
    body: "'How a company like yours went from A to B in N weeks' replies at about 10%, numbers hooks at 8.6%, social proof at 6.5%, a generic problem statement at 4.4%. Only use proof you can source.",
    stat: "10% vs 4.4%",
    sources: [DIGITAL_BLOOM],
  },
  {
    id: "personalization",
    category: "copy",
    title: "Deep personalization beats merge tags",
    body: "Research-based personalization (a real post, a hiring signal, a new role) lifts replies by about 52%, versus 20 to 25% for first name and company tags.",
    stat: "+52%",
    sources: [DIGITAL_BLOOM],
  },
  {
    id: "cohorts",
    category: "targeting",
    title: "Small cohorts, tight ICP",
    body: "Campaigns of 50 people or fewer reply 2.76 times more than 1,000+ blasts. Split by persona and by signal rather than by volume.",
    stat: "x2.76",
    sources: [DIGITAL_BLOOM],
  },
  {
    id: "sales_leaders",
    category: "targeting",
    title: "Heads of Sales are the most solicited buyers",
    body: "Sales leaders reply less than average (6.6%) because they receive the most cold outreach. Be specific: their hiring, their ramp, their quota. Quota attainment fell to about 43% in 2025 and managers coach less than 18% of their time: practice is the gap.",
    stat: "6.6% reply",
    sources: [DIGITAL_BLOOM, HYPERBOUND, KURLAN],
  },
  {
    id: "multichannel",
    category: "multichannel",
    title: "Email + LinkedIn, then a call",
    body: "Add a LinkedIn touch 1 to 2 days after the first email and a call around day 5 to 8. Two or three channels outperform email alone; LinkedIn adds the human layer.",
    sources: [MULTICHANNEL],
  },
  {
    id: "timing",
    category: "deliverability",
    title: "Send Monday to Thursday",
    body: "Wednesday gets the highest reply rate; Friday concentrates out-of-office replies. Spread sends across the day instead of blasting at 9:00.",
    sources: [INSTANTLY_2026],
  },
  {
    id: "deliverability",
    category: "deliverability",
    title: "Protect the domain",
    body: "Plain text, no tracking pixel, no links in the first email, bounce rate under 2%, steady daily volume (30 to 50 per mailbox). Ideally send from a secondary domain with SPF, DKIM and DMARC, warmed up for 2 to 4 weeks.",
    stat: "< 2% bounces",
    sources: [INSTANTLY_2026],
  },
];

/** Règles compressées injectées dans le prompt d'écriture (français, comme les autres prompts). */
export const BEST_PRACTICES_PROMPT = `## Ce qui marche en prospection en séquence (benchmarks)
- 58 % des réponses viennent du 1er email : il doit se suffire à lui-même. Les relances apportent les 42 % restants, chacune avec un NOUVEL angle.
- Court : 1er email 50 à 90 mots (max 120), relances 30 à 70 mots. Un seul CTA, binaire et léger ("Worth a look?", "Ça vaut le coup d'en parler ?").
- Le problème avant la solution. Coachello en une phrase, jamais un catalogue.
- Accroches par efficacité : timeline / cas comparable (si une preuve existe) > chiffre > social proof > problème générique.
- Personnalisation profonde : un fait réel et récent sur la personne ou son entreprise (post, recrutement, prise de poste, actu), cité naturellement en 1re phrase. Jamais de flatterie creuse.
- Relance en réponse dans le thread : pas de nouveau sujet, commence comme une suite naturelle de la conversation, sans "je me permets de relancer", "just checking in", "petite relance", "following up".
- Break-up final : 2 à 3 lignes, sans culpabiliser, question oui/non, porte ouverte.
- Ton humain, phrases courtes, pas de jargon marketing, pas de superlatifs, pas de points d'exclamation dans les sujets, pas de liens dans le 1er email.
- Sujets : 2 à 5 mots, minuscules naturelles, intrigants mais honnêtes (pas de "Re:" factice).`;
