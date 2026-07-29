/**
 * Sonde Apollo — que renvoie RÉELLEMENT chaque endpoint, et à quel prix ?
 *
 * Pourquoi ce script : le pipeline Signals a été conçu en supposant que People
 * Search renvoyait un nom complet et le domaine de la société. C'est faux (le nom
 * de famille est masqué, l'organisation ne porte que son nom), et personne ne
 * pouvait le voir parce que `mapPerson` avale les champs absents en `null`.
 *
 * Usage :
 *   npx tsx scripts/probe-apollo.ts                      # search seul, 0 crédit
 *   npx tsx scripts/probe-apollo.ts --match "Prénom Nom" --org "Société"
 *
 * Le mode --match appelle /people/match, dont le coût en crédits n'est PAS
 * garanti à zéro : il est donc explicite et jamais lancé par défaut.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const KEY = process.env.APOLLO_API_KEY;
const BASE = "https://api.apollo.io/api/v1";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function call(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "x-api-key": KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const limits = Object.fromEntries(
    [...res.headers.entries()].filter(([k]) => k.startsWith("x-") && k.includes("limit")),
  );
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  return { status: res.status, data, limits };
}

/** Liste les champs réellement peuplés, pour voir ce que le plan Apollo autorise. */
function present(o: Record<string, unknown>, indent = "  "): string {
  return Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${indent}${k} = ${JSON.stringify(v).slice(0, 90)}`)
    .join("\n");
}

async function main() {
  if (!KEY) throw new Error("APOLLO_API_KEY manquante dans .env.local");
  const org = arg("org") ?? "Doctolib";

  console.log(`\n=== 1. /mixed_people/api_search (gratuit) — org "${org}" ===`);
  const search = await call("/mixed_people/api_search", {
    page: 1,
    per_page: 2,
    q_organization_name: org,
    person_titles: ["DRH", "People", "Talent", "Learning"],
    person_seniorities: ["c_suite", "vp", "head", "director"],
  });
  console.log(`HTTP ${search.status} | rate limit:`, search.limits);
  const people = ((search.data as { people?: Record<string, unknown>[] })?.people ?? []).slice(0, 2);
  if (!people.length) console.log("  aucune personne renvoyée");
  for (const p of people) {
    console.log("--- personne : champs non nuls");
    console.log(present(p));
    const o = (p.organization as Record<string, unknown>) ?? {};
    console.log("--- organization : champs non nuls");
    console.log(present(o, "    "));
    console.log(
      `  >> nom complet ? ${p.last_name ? "OUI" : "NON (masqué)"} | domaine ? ${
        o.primary_domain || o.website_url ? "OUI" : "NON"
      }`,
    );
  }

  const who = arg("match");
  if (!who) {
    console.log(
      "\n=== 2. /people/match — NON LANCÉ ===\n" +
        '  Relancer avec : --match "Prénom Nom" --org "Société"\n' +
        "  Le coût en crédits de cet endpoint sans reveal n'est pas garanti nul :\n" +
        "  c'est précisément ce qu'on veut mesurer, sur UN seul appel.",
    );
    return;
  }

  const [firstName, ...rest] = who.split(/\s+/);
  console.log(`\n=== 2. /people/match (coût à vérifier) — "${who}" chez "${org}" ===`);
  const match = await call("/people/match", {
    first_name: firstName,
    last_name: rest.join(" "),
    organization_name: org,
    reveal_personal_emails: false,
    reveal_phone_number: false,
  });
  console.log(`HTTP ${match.status} | rate limit:`, match.limits);
  const person = (match.data as { person?: Record<string, unknown> })?.person;
  if (!person) {
    console.log("  aucune personne renvoyée :", JSON.stringify(match.data).slice(0, 300));
    return;
  }
  console.log("--- personne : champs non nuls");
  console.log(present(person));
  const morg = (person.organization as Record<string, unknown>) ?? {};
  console.log("--- organization : champs non nuls");
  console.log(present(morg, "    "));
  console.log(
    `\n  >> VERDICT : nom complet ${person.last_name ? "OUI" : "NON"} | domaine ${
      morg.primary_domain || morg.website_url ? `OUI (${morg.primary_domain ?? morg.website_url})` : "NON"
    } | email ${person.email ?? "absent"}`,
  );
  console.log(
    "  >> Vérifier la consommation de crédits sur https://app.apollo.io/#/settings/credits\n" +
      "     AVANT/APRÈS cet appel. Si elle bouge, matchPerson n'est pas gratuit et\n" +
      "     l'échelle de résolution de domaine ne doit pas s'appuyer dessus.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
