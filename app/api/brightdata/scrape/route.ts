import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const API_KEY = process.env.BRIGHTDATA_API_KEY;
const DATASET_ID = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID || "gd_l1viktl72bvl7bjuj0";
const BASE = "https://api.brightdata.com/datasets/v3";

function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ── POST : déclenche un scrape "discover by name" et renvoie le snapshot_id ──
// Le scraping Bright Data est asynchrone : on déclenche, puis le front poll le
// GET ci-dessous jusqu'à ce que les données soient prêtes (évite le timeout
// Netlify ~26s sur les fonctions synchrones).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!API_KEY) {
    return NextResponse.json({ error: "BRIGHTDATA_API_KEY manquante dans l'environnement" }, { status: 500 });
  }

  let body: { firstName?: string; lastName?: string; company?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const firstName = body.firstName?.trim() ?? "";
  const lastName = body.lastName?.trim() ?? "";
  if (!firstName || !lastName) {
    return NextResponse.json({ error: "Prénom et nom requis" }, { status: 400 });
  }

  const url = `${BASE}/trigger?dataset_id=${DATASET_ID}&include_errors=true&type=discover_new&discover_by=name`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify([{ first_name: firstName, last_name: lastName }]),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Bright Data ${res.status}: ${text.slice(0, 300)}` },
      { status: res.status },
    );
  }

  let json: { snapshot_id?: string };
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: `Réponse Bright Data inattendue: ${text.slice(0, 200)}` }, { status: 502 });
  }

  if (!json.snapshot_id) {
    return NextResponse.json({ error: "snapshot_id absent de la réponse Bright Data" }, { status: 502 });
  }

  return NextResponse.json({ snapshotId: json.snapshot_id });
}

// ── GET ?snapshot_id=... : poll l'état du snapshot ──────────────────────────
// status "running" => pas encore prêt ; "ready" => renvoie les profils.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!API_KEY) {
    return NextResponse.json({ error: "BRIGHTDATA_API_KEY manquante dans l'environnement" }, { status: 500 });
  }

  const snapshotId = req.nextUrl.searchParams.get("snapshot_id")?.trim();
  if (!snapshotId) {
    return NextResponse.json({ error: "snapshot_id requis" }, { status: 400 });
  }

  // 1) état du snapshot
  const progressRes = await fetch(`${BASE}/progress/${snapshotId}`, { headers: authHeaders() });
  const progressText = await progressRes.text();
  if (!progressRes.ok) {
    return NextResponse.json(
      { error: `Bright Data ${progressRes.status}: ${progressText.slice(0, 300)}`, status: "error" },
      { status: progressRes.status },
    );
  }

  let progress: { status?: string };
  try {
    progress = JSON.parse(progressText);
  } catch {
    progress = {};
  }

  const status = progress.status ?? "unknown";
  if (status !== "ready") {
    // running / building / collecting ... pas encore de données
    return NextResponse.json({ status, ready: false });
  }

  // 2) snapshot prêt => on récupère les données
  const dataRes = await fetch(`${BASE}/snapshot/${snapshotId}?format=json`, { headers: authHeaders() });
  const dataText = await dataRes.text();
  if (!dataRes.ok) {
    return NextResponse.json(
      { error: `Bright Data ${dataRes.status}: ${dataText.slice(0, 300)}`, status: "error" },
      { status: dataRes.status },
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(dataText);
  } catch {
    return NextResponse.json({ error: "Données Bright Data illisibles", status: "error" }, { status: 502 });
  }

  const profiles = Array.isArray(data) ? data : [data];
  return NextResponse.json({ status: "ready", ready: true, profiles });
}
