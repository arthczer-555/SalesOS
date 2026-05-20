import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const id = process.argv[2];
  const { data } = await db.from("sales_coach_analyses").select("analysis").eq("id", id).single();
  const a = data?.analysis as Record<string, unknown>;
  for (const [k, v] of Object.entries(a ?? {})) {
    let typ: string;
    if (Array.isArray(v)) typ = `array[${v.length}]`;
    else if (v === null) typ = "null";
    else if (typeof v === "object") typ = `object(keys=${Object.keys(v).slice(0, 5).join(",")}...)`;
    else typ = `${typeof v} len=${typeof v === "string" ? (v as string).length : "?"}`;
    console.log(`${k}: ${typ}`);
  }
}
main();
