/**
 * Construit un prompt d'écriture Prospecting d'exemple, sans aucun appel réseau,
 * et vérifie ses invariants :
 *   npx tsx scripts/test-prospecting-prompt.ts
 * - aucun tiret long ni moyen nulle part (les guides et Notion en contiennent :
 *   ils doivent être nettoyés à l'injection) ;
 * - 3 blocs système, tous marqués cache_control (cache sur tout un batch) ;
 * - règle d'or, preuves autorisées, roster et spec de chaque étape présents ;
 * - langue imposée dans le message utilisateur.
 */
import { DEFAULT_PROSPECTION_GUIDE } from "../lib/guides/prospection";
import {
  buildProspectMessage,
  buildSequenceSystem,
  resolveLanguage,
  WRITE_SEQUENCE_TOOL,
  type PromptStep,
} from "../lib/prospecting/ai/prompt";
import { DEFAULT_PERSONAS } from "../lib/prospecting/personas";
import { SYSTEM_TEMPLATES } from "../lib/prospecting/templates";
import type { ContactResearch } from "../lib/prospecting/types";

const LONG_DASHES = /[\u2014\u2013]/;

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

const persona = DEFAULT_PERSONAS.find((p) => p.id === "sales_leaders");
const template = SYSTEM_TEMPLATES.find((t) => t.key === "sales_leaders_roleplay");
if (!persona || !template) throw new Error("Default persona or template missing");

const steps: PromptStep[] = template.steps.map((s, i) => ({
  position: i + 1,
  kind: s.kind,
  threadMode: s.threadMode,
  delayDays: s.delayDays,
  config: s.config,
}));

// Connaissance simulée avec des tirets longs, comme une vraie page Notion.
const knowledge = {
  text: "### AI coaching & role-play (Notion)\nRoleplays \u2014 built on the client's ICP \u2013 scored with feedback.",
  source: "notion" as const,
  pages: [{ id: "3a61c2f23b0e816dae02ed8cbf825b51", title: "AI coaching & role-play", fetchedAt: "2026-09-30T08:00:00Z", error: null }],
};

const system = buildSequenceSystem({
  persona,
  knowledge,
  houseStyle: DEFAULT_PROSPECTION_GUIDE,
  campaign: { name: "Heads of Sales \u2014 Q4", goal: "Book a 15-minute roleplay demo", instructions: "Mention the SKO season.", language: "auto", softOptOut: true },
  steps,
  roster: "- Qonto (Fintech)\n- Spendesk (SaaS)",
  senderName: "Gaspard Dupont",
});

const research: ContactResearch = {
  brief: {
    summary: "VP Sales at a 300-person SaaS company hiring 4 AEs.",
    hooks: [{ text: "Hiring 4 Account Executives in Paris", kind: "hiring", sourceUrl: "https://linkedin.com/jobs/1", date: "2026-09-20", strength: 3 }],
    pains: ["Ramp time of new AEs \u2014 long"],
    personaFit: { score: 82, reason: "Owns the sales team and is scaling it." },
    suggestedAngle: "Ramp time of the new AEs",
    language: "fr",
    doNotMention: ["Last year's layoffs"],
  },
  facts: { hiring: "4 poste(s) sales parmi les 10 dernières offres." },
  sources: [{ label: "Job post", url: "https://linkedin.com/jobs/1" }],
  errors: ["LinkedIn posts unavailable (timeout)"],
  fetchedAt: "2026-10-01T10:00:00Z",
};
const contact = {
  first_name: "Camille",
  last_name: "Martin",
  title: "VP Sales",
  company_name: "Acme",
  company_domain: "acme.fr",
  country: "France",
  location: "Paris",
  industry: "Software",
  company_size: "201-500",
  linkedin_url: "https://www.linkedin.com/in/camille-martin/",
  email: "camille@acme.fr",
};
const language = resolveLanguage("auto", research, contact);
const user = buildProspectMessage({ contact, research, language, targets: steps.map((s) => s.position), existing: [] });

const all = [...system.map((b) => b.text), user, JSON.stringify(WRITE_SEQUENCE_TOOL)].join("\n");

check("3 system blocks", system.length === 3, `got ${system.length}`);
check("every system block is cached", system.every((b) => b.cache_control?.type === "ephemeral"));
check("no em dash or en dash anywhere in the prompt", !LONG_DASHES.test(all), all.match(new RegExp(`.{0,40}${LONG_DASHES.source}.{0,40}`))?.[0]);
check("golden rule present", all.includes("RÈGLE D'OR"));
check("proof points listed", persona.messaging.proofPoints.every((p) => all.includes(p.text.replace(/[\u2014\u2013]/g, "-"))));
check("insights listed", persona.messaging.insights.every((p) => all.includes(p.text)));
check("competitor-published insight not attributed", !all.includes("source : Hyperbound") && all.includes("NE NOMME PAS la source"));
check("other insight sources kept", all.includes("source : CSO Insights sales enablement study"));
check("roster present", all.includes("Qonto (Fintech)"));
check("every step specified", steps.every((s) => all.includes(`Étape ${s.position} · Jour`)));
check("reply step flagged as thread", all.includes("Email en réponse dans le thread de l'étape 1"));
check("LinkedIn invite limit stated", all.includes("200 caractères"));
check("call format stated", all.includes("Talk track:") && all.includes("Voicemail:"));
check("soft opt-out stated", all.includes("Opt-out doux"));
check("house style treated as style only", all.includes("ne sont PAS des preuves autorisées"));
check("language resolved to French", language === "fr");
check("language enforced in user message", user.includes("Langue imposée : français"));
check("do-not-mention forwarded", user.includes("Last year's layoffs"));
check("failed sources forwarded", user.includes("LinkedIn posts unavailable"));

const chars = all.length;
console.log(`\nPrompt size: ${chars.toLocaleString("en-US")} characters (about ${Math.round(chars / 3.6).toLocaleString("en-US")} tokens)`);
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
