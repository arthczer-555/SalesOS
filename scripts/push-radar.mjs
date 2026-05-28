import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const DELAY_MS = 1500;

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const NETROWS_KEY = env.NETROWS_API_KEY;

const profiles = JSON.parse(readFileSync("netrows-recovered.json", "utf8"));

// Companies canoniques de scope_companies pour vérifier le lien (match insensible casse)
const { data: scope } = await db.from("scope_companies").select("name");
const scopeByLower = new Map((scope ?? []).map((c) => [c.name.toLowerCase(), c.name]));

// Dédup : quels usernames sont déjà actifs au radar ?
const usernames = profiles.map((p) => p.username);
const { data: existing } = await db
  .from("linkedin_monitored_profiles")
  .select("username, radar_active")
  .in("username", usernames);
const activeSet = new Set((existing ?? []).filter((r) => r.radar_active === true).map((r) => r.username));

const toAdd = profiles.filter((p) => !activeSet.has(p.username));
const unmatchedCompany = [...new Set(toAdd.map((p) => p.company).filter((c) => c && !scopeByLower.has(c.toLowerCase())))];

console.log(`Profils récupérés      : ${profiles.length}`);
console.log(`Déjà actifs au radar   : ${activeSet.size} (skip, 0 crédit)`);
console.log(`À ajouter (nouveaux)   : ${toAdd.length}  → ${toAdd.length} crédits Netrows`);
console.log(`Companies hors scope   : ${unmatchedCompany.length}${unmatchedCompany.length ? " → " + unmatchedCompany.join(", ") : ""}`);

if (!COMMIT) {
  console.log(`\n[DRY-RUN] Rien poussé. Relance avec --commit pour ajouter au radar.`);
  process.exit(0);
}

if (!NETROWS_KEY) { console.error("NETROWS_API_KEY manquante"); process.exit(1); }

async function addToRadar(username) {
  const res = await fetch("https://api.netrows.com/v1/radar/profiles", {
    method: "POST",
    headers: { Authorization: `Bearer ${NETROWS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // 400 "Already monitoring" = déjà enregistré côté Netrows (ex: run précédent
    // qui a timeout après traitement). On le traite comme un succès pour upsert
    // la ligne DB manquante.
    if (res.status === 400 && t.includes("Already monitoring")) return { success: true, already: true };
    throw new Error(`Netrows ${res.status}: ${t.slice(0, 160)}`);
  }
  return res.json();
}

const added = [];
const failed = [];
for (let i = 0; i < toAdd.length; i++) {
  const p = toAdd[i];
  // Company canonique : on aligne sur scope_companies si on a un match casse-insensible
  const canonical = p.company ? scopeByLower.get(p.company.toLowerCase()) ?? p.company : null;
  try {
    await addToRadar(p.username);
    const row = {
      username: p.username,
      full_name: p.fullName ?? [p.firstName, p.lastName].filter(Boolean).join(" "),
      headline: p.headline ?? null,
      company: canonical,
      profile_url: p.profileUrl ?? `https://www.linkedin.com/in/${p.username}/`,
      source: p.source ?? "netrows-search",
      radar_active: true,
    };
    const { error } = await db.from("linkedin_monitored_profiles").upsert(row, { onConflict: "username" });
    if (error) throw new Error(`DB upsert: ${error.message}`);
    added.push(p.username);
    console.log(`  [${i + 1}/${toAdd.length}] + ${p.username} (${canonical})`);
  } catch (e) {
    failed.push({ username: p.username, error: e.message });
    console.log(`  [${i + 1}/${toAdd.length}] ! ${p.username} — ${e.message}`);
  }
  if (i < toAdd.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\nAjoutés : ${added.length} | Échecs : ${failed.length}`);
if (failed.length) console.log(JSON.stringify(failed, null, 2));
