// Liste de suppression d'équipe (emails et domaines à ne jamais contacter).
import { db } from "@/lib/db";
import { domainOfEmail, normDomain, normEmail } from "./util";

export interface SuppressionSets {
  emails: Set<string>;
  domains: Set<string>;
}

/** Charge les suppressions qui concernent ces emails / domaines (requêtes ciblées). */
export async function loadSuppressionSets(emails: string[], domains: string[]): Promise<SuppressionSets> {
  const e = Array.from(new Set(emails.map((x) => normEmail(x)).filter((x): x is string => !!x)));
  const d = Array.from(new Set([...domains.map((x) => normDomain(x)), ...e.map((x) => domainOfEmail(x))].filter((x): x is string => !!x)));
  const out: SuppressionSets = { emails: new Set(), domains: new Set() };
  const queries: PromiseLike<void>[] = [];
  for (let i = 0; i < e.length; i += 200) {
    const slice = e.slice(i, i + 200);
    queries.push(
      db
        .from("prospecting_suppressions")
        .select("value")
        .eq("kind", "email")
        .in("value", slice)
        .then(({ data }) => {
          for (const r of data ?? []) out.emails.add((r as { value: string }).value);
        }),
    );
  }
  for (let i = 0; i < d.length; i += 200) {
    const slice = d.slice(i, i + 200);
    queries.push(
      db
        .from("prospecting_suppressions")
        .select("value")
        .eq("kind", "domain")
        .in("value", slice)
        .then(({ data }) => {
          for (const r of data ?? []) out.domains.add((r as { value: string }).value);
        }),
    );
  }
  await Promise.all(queries);
  return out;
}

export function isSuppressed(sets: SuppressionSets, email: string | null | undefined, domain?: string | null): boolean {
  const e = normEmail(email);
  if (e && sets.emails.has(e)) return true;
  const d = normDomain(domain) ?? domainOfEmail(e);
  return !!d && sets.domains.has(d);
}

export async function isEmailSuppressed(email: string | null | undefined, domain?: string | null): Promise<boolean> {
  const sets = await loadSuppressionSets(email ? [email] : [], domain ? [domain] : []);
  return isSuppressed(sets, email, domain);
}

export async function addSuppression(input: {
  kind: "email" | "domain";
  value: string;
  reason: string;
  note?: string | null;
  sourceReplyId?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const value = input.kind === "email" ? normEmail(input.value) : normDomain(input.value);
  if (!value) return;
  const { error } = await db.from("prospecting_suppressions").upsert(
    {
      kind: input.kind,
      value,
      reason: input.reason,
      note: input.note ?? null,
      source_reply_id: input.sourceReplyId ?? null,
      created_by: input.createdBy ?? null,
    },
    { onConflict: "kind,value", ignoreDuplicates: true },
  );
  if (error) console.error("[prospecting] suppression upsert failed:", error.message);
}
