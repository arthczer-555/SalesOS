import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Charge .env.local sans dépendance
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await db
  .from("netrows_search_jobs")
  .select("id, status, combos_done, combos_total, total, profiles, created_at, updated_at, error_message")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (error) {
  console.error("Erreur DB:", error.message);
  process.exit(1);
}
if (!data) {
  console.error("Aucun job trouvé.");
  process.exit(1);
}

const profiles = data.profiles ?? [];
console.log(`Job ${data.id}`);
console.log(`  status      : ${data.status}`);
console.log(`  combos      : ${data.combos_done}/${data.combos_total}`);
console.log(`  profils     : ${profiles.length}`);
console.log(`  créé le     : ${data.created_at}`);
console.log(`  maj le      : ${data.updated_at}`);
if (data.error_message) console.log(`  error       : ${data.error_message}`);

writeFileSync("netrows-recovered.json", JSON.stringify(profiles, null, 2));

const esc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cols = ["fullName", "firstName", "lastName", "headline", "company", "username", "profileUrl", "source"];
const csv = [
  cols.join(","),
  ...profiles.map((p) => cols.map((c) => esc(p[c])).join(",")),
].join("\n");
writeFileSync("netrows-recovered.csv", csv);

console.log(`\nExporté → netrows-recovered.json (${profiles.length} profils) + netrows-recovered.csv`);
