/**
 * One-off : vérifie la chaîne "crédit épuisé" (détection + DM Slack).
 *
 * Par défaut, DRY RUN : affiche seulement ce que la détection donne sur des
 * messages réels de fournisseurs, aucun Slack envoyé.
 *
 * Usage :
 *   npx tsx scripts/test-credit-alert.ts            # détection seule (dry run)
 *   npx tsx scripts/test-credit-alert.ts --slack    # ENVOIE un vrai DM à Gaspard + Arthur
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { reportInsufficientCredit } from "../lib/credit-alert";
import { friendlyErrorMessage, isCreditText } from "../lib/credit-error";

// Messages réellement renvoyés par les APIs (Anthropic = 400, pas 402) + des
// contre-exemples qui NE doivent PAS être pris pour un crédit épuisé.
const SAMPLES: { label: string; text: string; expected: boolean }[] = [
  {
    label: "Anthropic 400",
    text: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
    expected: true,
  },
  { label: "Apollo", text: '{"error":"You have run out of email credits"}', expected: true },
  { label: "HeyGen", text: "insufficient credit for this render", expected: true },
  { label: "Bright Data", text: "Not enough balance in your account", expected: true },
  { label: "Anthropic 429 (rate limit)", text: "429 rate_limit_error: per-minute rate limit", expected: false },
  { label: "GA4 quota", text: "Quota exceeded for quota metric 'Queries'", expected: false },
  { label: "HubSpot 500", text: "HubSpot 500 internal error", expected: false },
];

async function main() {
  const sendSlack = process.argv.slice(2).includes("--slack");

  let ko = 0;
  for (const s of SAMPLES) {
    const got = isCreditText(s.text);
    const ok = got === s.expected;
    if (!ok) ko++;
    console.log(`${ok ? "ok  " : "KO  "} ${s.label.padEnd(28)} détecté=${got} attendu=${s.expected}`);
  }
  console.log(`\nMessage affiché au user : "${friendlyErrorMessage(SAMPLES[0].text)}"`);
  console.log(ko === 0 ? "\nDétection : tous les cas passent." : `\nDétection : ${ko} cas KO.`);

  if (!sendSlack) {
    console.log("\n(dry run — relancer avec --slack pour envoyer le DM de test)");
    return;
  }

  console.log("\nEnvoi du DM de test (Gaspard + Arthur)…");
  await reportInsufficientCredit({
    provider: "Claude (Anthropic)",
    detail: "TEST manuel via scripts/test-credit-alert.ts — aucun crédit réellement épuisé.",
    context: "scripts/test-credit-alert.ts",
    force: true, // sinon la garde "1 alerte / jour / fournisseur" avale le test
  });
  console.log("Envoyé (voir Slack).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
