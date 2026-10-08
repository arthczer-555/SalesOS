import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotSearchAll } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/contact-links
// Liens des contacts de la fiche (Knowledge > Contacts) : id du contact HubSpot
// et URL LinkedIn (hs_linkedin_url) retrouvés par email, en une seule recherche
// HubSpot. Chargé à part par la carte Contacts pour ne pas ralentir la fiche.
// Réponse : { links: { [emailEnMinuscules]: { hubspotId, linkedinUrl } } }.

const CONTACT_KEYS = ["contact_signataire", "contact_principal_rh", "contact_rh_operationnel", "contact_facturation", "contact_it"];

type Contact = { name?: string | null; email?: string | null };
type ContactLink = { hubspotId: string; linkedinUrl: string | null };

function emailOf(c: unknown): string | null {
  const email = (c as Contact | null)?.email;
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await db.from("clients").select("fields_json").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gi = ((data.fields_json as Record<string, unknown> | null)?.general_info ?? {}) as Record<string, { value?: unknown } | undefined>;
  const others = Array.isArray(gi.autres_parties_prenantes?.value) ? (gi.autres_parties_prenantes?.value as unknown[]) : [];
  const emails = [
    ...new Set(
      [...CONTACT_KEYS.map((k) => gi[k]?.value), ...others]
        .map(emailOf)
        .filter((e): e is string => !!e),
    ),
  ];
  if (emails.length === 0) return NextResponse.json({ links: {} });

  try {
    const rows = await hubspotSearchAll<{ id: string; properties?: { email?: string | null; hs_linkedin_url?: string | null } }>(
      "contacts",
      {
        filterGroups: [{ filters: [{ propertyName: "email", operator: "IN", values: emails }] }],
        properties: ["email", "hs_linkedin_url"],
        limit: 100,
      },
      100,
    );
    const links: Record<string, ContactLink> = {};
    for (const r of rows) {
      const email = r.properties?.email?.trim().toLowerCase();
      if (!email || links[email]) continue;
      links[email] = { hubspotId: r.id, linkedinUrl: r.properties?.hs_linkedin_url || null };
    }
    return NextResponse.json({ links });
  } catch (e) {
    console.error("[contact-links] HubSpot search failed:", e);
    return NextResponse.json({ error: "HubSpot unreachable" }, { status: 502 });
  }
}
