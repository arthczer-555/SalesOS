import { createClient } from "@supabase/supabase-js";

// Server-side only — never expose SUPABASE_SERVICE_ROLE_KEY to the browser
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
