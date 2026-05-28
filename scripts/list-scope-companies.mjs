import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await db.from("scope_companies").select("id,name,owner").order("name");
if (error) { console.error(error.message); process.exit(1); }
console.log("scope_companies total:", data.length);
for (const c of data) console.log(`- ${c.name}${c.owner ? "  ("+c.owner+")" : ""}`);
