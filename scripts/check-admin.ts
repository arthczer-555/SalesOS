import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db
    .from("users")
    .select("id, email, is_admin")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  for (const r of data ?? []) {
    console.log(`${r.is_admin ? "[ADMIN]" : "       "} ${r.email}  (${r.id})`);
  }
}
main();
