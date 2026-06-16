import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { revealPhone, isApolloConfigured } from "@/lib/apollo/client";
import { writeRevealedPhoneToHubspot } from "@/lib/watchlist/reveal-contact-phone";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";

export const dynamic = "force-dynamic";

interface ContactProps {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  mobilephone?: string;
}

async function readContact(contactId: string): Promise<ContactProps> {
  const res = await hubspotFetch<{ properties?: ContactProps }>(
    `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,mobilephone`,
  );
  return res.properties ?? {};
}

// GET : lit le numéro courant du contact (sert au polling pendant le reveal
// async — le webhook Apollo écrit le numéro sur HubSpot, on le relit ici).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ phone: null, error: "Not authenticated" }, { status: 401 });
  const { contactId } = await params;
  try {
    const p = await readContact(contactId);
    return NextResponse.json({ phone: p.mobilephone || p.phone || null });
  } catch (e) {
    return NextResponse.json(
      { phone: null, error: e instanceof Error ? e.message : "HubSpot error" },
      { status: 500 },
    );
  }
}

// POST : déclenche le reveal Apollo (consomme un crédit téléphone). Fast-path
// si Apollo renvoie un numéro tout de suite, sinon "pending" : Apollo enverra le
// numéro au webhook (async) et le front pollera le GET ci-dessus.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ status: "error", error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) {
    return NextResponse.json({ status: "error", error: "Apollo not configured" }, { status: 400 });
  }

  const { id, contactId } = await params;

  let contact: ContactProps;
  try {
    contact = await readContact(contactId);
  } catch {
    return NextResponse.json({ status: "error", error: "Contact not found in HubSpot" }, { status: 404 });
  }

  // Si le numéro est déjà connu, on ne dépense pas de crédit.
  const existingPhone = contact.mobilephone || contact.phone || null;
  if (existingPhone) return NextResponse.json({ status: "done", phone: existingPhone });

  // Domaine : email du contact en priorité, sinon domaine de la company liée.
  const hasEmail = !!(contact.email && contact.email.includes("@"));
  let domain: string | null = hasEmail ? contact.email!.split("@")[1] || null : null;
  if (!domain) {
    try {
      const resolved = await resolveHubspotCompanyId(id);
      if (resolved.hubspot_company_id) {
        const co = await hubspotFetch<{ properties?: { domain?: string } }>(
          `/crm/v3/objects/companies/${resolved.hubspot_company_id}?properties=domain`,
        );
        domain = co.properties?.domain || null;
      }
    } catch {
      /* best-effort : on tentera avec ce qu'on a */
    }
  }

  // Pas assez d'info pour matcher : on évite un appel (et un crédit) inutile.
  const hasName = !!(contact.firstname || contact.lastname);
  if (!hasEmail && !(hasName && domain)) {
    return NextResponse.json(
      { status: "error", error: "Not enough info to reveal (need an email, or a name + company domain)" },
      { status: 422 },
    );
  }

  const secret = process.env.INTERNAL_SECRET;
  const webhookUrl = `${req.nextUrl.origin}/api/apollo/phone-webhook/${contactId}${
    secret ? `?secret=${encodeURIComponent(secret)}` : ""
  }`;

  const result = await revealPhone(
    {
      email: hasEmail ? contact.email : undefined,
      firstName: contact.firstname || undefined,
      lastName: contact.lastname || undefined,
      domain: domain || undefined,
    },
    webhookUrl,
  );

  if (!result.raw.ok) {
    return NextResponse.json(
      { status: "error", error: result.raw.error || "Apollo reveal failed" },
      { status: 502 },
    );
  }

  // Fast-path : numéro déjà dispo dans la réponse synchrone -> écrit sur HubSpot.
  if (result.phone) {
    try {
      await writeRevealedPhoneToHubspot(contactId, result.phone);
    } catch {
      return NextResponse.json({ status: "done", phone: result.phone, warning: "HubSpot update failed" });
    }
    return NextResponse.json({ status: "done", phone: result.phone });
  }

  // Sinon : Apollo enverra le numéro au webhook (async).
  return NextResponse.json({ status: "pending" });
}
