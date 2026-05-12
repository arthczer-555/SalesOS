import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { RadarWebhookPayload } from "@/lib/netrows";
import { getTargetCompanies, getAlertConfig } from "@/lib/target-companies";

interface IcpScoreResult {
  score: number;          // 0-100
  reasoning: string;
  is_match: boolean;
}

async function scoreIcpMatch(
  newCompany: string,
  newHeadline: string
): Promise<IcpScoreResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system:
        "Tu évalues la pertinence d'une entreprise et d'un nouveau poste pour Coachello (coaching managérial B2B France). ICP : entreprises 200+ employés, secteurs Tech/Finance/Industrie/Conseil/Retail. Cible : managers RH/People/L&D/Talent.",
      messages: [
        {
          role: "user",
          content: `Nouvelle entreprise : ${newCompany}\nNouveau poste : ${newHeadline}\n\nRends ton analyse en JSON :\n{ "score": 0-100, "reasoning": "1 phrase", "is_match": true|false }`,
        },
      ],
    });
    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as IcpScoreResult;
  } catch (e) {
    console.warn("[netrows-webhook] ICP scoring failed:", e);
    return null;
  }
}

async function postSlackAlert(args: {
  title: string;
  why: string;
  action: string;
  score: number;
  sourceUrl: string;
}): Promise<void> {
  const config = await getAlertConfig();
  if (!config.enabled) return;
  if (args.score < (config.min_score ?? 70)) return;

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = config.slack_channel;
  if (!token || !channelId) return;

  const text = [
    `🟢 *${args.score}/100* — ${args.title}`,
    args.why,
    `→ ${args.action}`,
    `<${args.sourceUrl}|Voir sur LinkedIn>`,
  ].join("\n");

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelId, text, unfurl_links: false }),
    });
  } catch (e) {
    console.warn("[netrows-webhook] slack post failed:", e);
  }
}

function buildEventKey(body: RadarWebhookPayload): string {
  const subject = body.profile?.username ?? body.company?.username ?? "unknown";
  const changeSig = body.changes
    .map((c) => `${c.field}:${String(c.oldValue)}>${String(c.newValue)}`)
    .sort()
    .join("|");
  return `${body.event}:${subject}:${body.timestamp}:${changeSig}`.slice(0, 500);
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // ── 1. Read raw body BEFORE parsing — Netrows signs the raw bytes ─────
    const rawBody = await req.text();

    // ── 2. Verify HMAC signature on the raw body ──────────────────────────
    const secret = process.env.NETROWS_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers.get("x-netrows-signature");
      const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      if (signature !== expected) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    let body: RadarWebhookPayload;
    try {
      body = JSON.parse(rawBody) as RadarWebhookPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // ── 3. Idempotency — drop duplicate events (Netrows retries on 5xx) ──
    const eventKey = buildEventKey(body);
    const claim = await db.from("netrows_events_processed").insert({ event_key: eventKey });
    if (claim.error?.code === "23505") {
      console.log(`[netrows-webhook] ignored: duplicate (${eventKey})`);
      return NextResponse.json({ ok: true, deduped: true });
    }
    if (claim.error) {
      // Any other DB error: log and proceed (one duplicate signal > zero signal).
      console.warn("[netrows-webhook] idempotency claim failed:", claim.error);
    }

    console.log("[netrows-webhook]", body.event, body.summary);

    // ── Company changed ──────────────────────────────────────────────
    if (body.event === "company.changed" && body.company) {
      const staffChange = body.changes.find((c) => c.field === "staffCount");
      if (staffChange) {
        const oldCount = Number(staffChange.oldValue) || 0;
        const newCount = Number(staffChange.newValue) || 0;
        const diff = Math.abs(newCount - oldCount);
        const pct = oldCount > 0 ? (diff / oldCount) * 100 : 100;

        // Threshold: at least 30 people AND at least 10% movement.
        // Filters out "TotalEnergies +50" (0.05% on 100k) which is pure noise,
        // while keeping "100-person startup +15" (15%) which is meaningful.
        const isSignificant = pct >= 10 && diff >= 30;

        if (isSignificant) {
          const companyName = (body.newSnapshot.name as string) ?? body.company.username;
          const { data: allUsers } = await db.from("users").select("id");
          if (allUsers?.length) {
            const title = `${companyName} : effectifs ${newCount > oldCount ? "en hausse" : "en baisse"} (${oldCount} → ${newCount})`;
            const why = "Changement significatif d'effectifs — besoin potentiel de coaching managers.";
            const action = "Contacter le DRH pour proposer un accompagnement.";
            const score = pct > 20 ? 80 : 60;
            const sourceUrl = body.company.url;

            await db.from("market_signals").insert(
              allUsers.map((u: { id: string }) => ({
                user_id: u.id,
                agent_id: "hiring-spike",
                company_name: companyName,
                signal_type: "hiring",
                title,
                summary: `Changement de ${diff} employés (${pct.toFixed(0)}%) détecté via LinkedIn.`,
                strength: pct > 20 ? 3 : 2,
                score,
                source_url: sourceUrl,
                source_domain: "linkedin.com",
                why_relevant: why,
                suggested_action: action,
                action_type: "email",
                is_read: false,
                is_actioned: false,
              }))
            );

            await postSlackAlert({ title, why, action, score, sourceUrl });
          }
        }
      }
    }

    // ── Profile changed ──────────────────────────────────────────────
    if (body.event === "profile.changed" && body.profile) {
      const titleChange = body.changes.find((c) => c.field === "headline" || c.field === "position");
      if (titleChange) {
        const username = body.profile.username;
        const oldValue = String(titleChange.oldValue ?? "");
        const newValue = String(titleChange.newValue ?? "");

        // Update linkedin_monitored_profiles
        const { data: monitored } = await db
          .from("linkedin_monitored_profiles")
          .select("full_name, company, headline")
          .eq("username", username)
          .maybeSingle();

        const displayName = monitored?.full_name ?? username;
        const previousCompany = monitored?.company ?? "—";

        // Determine new company from snapshot or fallback to monitored profile's company
        const snapshotPosition = body.newSnapshot?.position as { companyName?: string }[] | undefined;
        const newCompany = snapshotPosition?.[0]?.companyName ?? previousCompany;

        // Persist the new headline + company so subsequent signals use fresh data.
        await db.from("linkedin_monitored_profiles")
          .update({
            headline: newValue,
            company: newCompany,
            last_snapshot: body.newSnapshot,
            last_change_at: new Date().toISOString(),
          })
          .eq("username", username);

        const isCompanyInTargets = await (async () => {
          try {
            const targets = (await getTargetCompanies()).map((t) => t.toLowerCase());
            return targets.some((t) => newCompany.toLowerCase().includes(t) || t.includes(newCompany.toLowerCase()));
          } catch {
            return true; // safe default → standard signal
          }
        })();

        // ICP match scoring (only when out of target list, to avoid double-up)
        let icpResult: IcpScoreResult | null = null;
        if (!isCompanyInTargets && newCompany && newCompany !== "—") {
          icpResult = await scoreIcpMatch(newCompany, newValue);
        }

        const isIcpMatch = !!icpResult?.is_match && (icpResult?.score ?? 0) >= 70;
        const finalSignalType = isIcpMatch ? "job_change_icp_match" : "job_change";
        const finalAgentId = "job-change";
        const finalScore = isIcpMatch ? icpResult!.score : 85;
        const finalWhyRelevant = isIcpMatch
          ? `${displayName} rejoint ${newCompany} — non listée dans les cibles mais ICP match (${icpResult!.score}/100). ${icpResult!.reasoning}`
          : `${displayName} a changé de poste — nouveau décideur potentiel pour le coaching.`;
        const title = `${displayName} change de poste${newCompany !== "—" ? ` chez ${newCompany}` : ""}`;
        const action = `Contacter ${displayName} pour se présenter et proposer un accompagnement.`;

        // Create signal for all users
        const { data: allUsers } = await db.from("users").select("id");
        if (allUsers?.length) {
          await db.from("market_signals").insert(
            allUsers.map((u: { id: string }) => ({
              user_id: u.id,
              agent_id: finalAgentId,
              company_name: newCompany,
              signal_type: finalSignalType,
              title,
              summary: `${oldValue} → ${newValue}`,
              strength: 3,
              score: finalScore,
              source_url: body.profile!.url,
              source_domain: "linkedin.com",
              why_relevant: finalWhyRelevant,
              suggested_action: action,
              action_type: "linkedin",
              is_read: false,
              is_actioned: false,
            }))
          );

          await postSlackAlert({
            title,
            why: finalWhyRelevant,
            action,
            score: finalScore,
            sourceUrl: body.profile.url,
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[netrows-webhook] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
