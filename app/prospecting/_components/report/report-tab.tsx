"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Info, RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { COLORS } from "@/lib/design/tokens";
import { useCampaignReport } from "@/lib/hooks/use-prospecting-report";
import { STEP_KIND_META } from "@/lib/prospecting/templates";
import type { CampaignRow } from "@/lib/prospecting/types";
import { StepKindIcon } from "../shared/meta";
import { pct } from "../shared/format";

// Couleurs validées (scripts/validate_palette.js du skill dataviz, mode clair).
const SENT_COLOR = "#3b82f6";
const REPLY_COLOR = COLORS.brand;

const BREAKDOWN_LABEL: Record<string, string> = {
  reply: "Prospect replied",
  colleague_reply: "Colleague replied",
  auto_reply: "Auto-reply (out of office...)",
  bounce_hard: "Hard bounce",
  bounce_soft: "Soft bounce",
};

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="ds-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="ds-kpi-label">{label}</span>
      <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: accent ? COLORS.brandDark : COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub ? <span style={{ fontSize: 12, color: COLORS.ink3 }}>{sub}</span> : null}
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: COLORS.ink0 }}>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function ErrorBlock({ what }: { what: string }) {
  return <div style={{ fontSize: 12.5, color: COLORS.err }}>Could not load {what}. The numbers here would be wrong, so they are hidden.</div>;
}

// Rapport de campagne : tuiles clés, entonnoir, réponses par catégorie, activité
// quotidienne et performance par étape. Chaque bloc gère son erreur.
export function ReportTab({ campaign }: { campaign: CampaignRow }) {
  const { report, error, isLoading, mutate } = useCampaignReport(campaign.id);

  if (error) {
    return (
      <Banner tone="err" title="The report could not be loaded" action={<Button size="sm" icon={RefreshCw} onClick={() => void mutate()}>Retry</Button>}>
        {error}
      </Banner>
    );
  }
  if (isLoading || !report) {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={88} radius={12} />
          ))}
        </div>
        <Skeleton height={260} radius={12} />
      </div>
    );
  }

  const s = report.stats;
  const failed = (k: string) => report.errors.some((e) => e.startsWith(k));
  const hardBounces = report.replyBreakdown.find((r) => r.category === "bounce_hard")?.count ?? 0;

  if (s && s.emails_sent === 0 && s.leads_contacted === 0 && report.steps.every((x) => x.done === 0)) {
    return (
      <div className="ds-card">
        <EmptyState icon={BarChart3} title="No activity yet" description="Numbers appear here once the first emails go out and tasks get done." />
      </div>
    );
  }

  const funnel = s
    ? [
        { label: "Prospects", value: s.leads_total },
        { label: "Contacted", value: s.leads_contacted },
        { label: "Replied", value: s.leads_replied },
        { label: "Meetings", value: s.leads_meetings },
      ]
    : [];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));
  const breakdownMax = Math.max(1, ...report.replyBreakdown.map((r) => r.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {failed("stats") ? (
        <ErrorBlock what="the campaign totals" />
      ) : s ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <Tile label="Contacted" value={s.leads_contacted.toLocaleString("en-US")} sub={`of ${s.leads_total} prospects`} />
          <Tile label="Reply rate" value={s.leads_contacted ? pct(s.leads_replied, s.leads_contacted) : "No sends"} sub={`${s.leads_replied} human replies`} accent />
          <Tile label="Replies" value={String(s.leads_replied)} sub="Sequence stopped, Slack sent" />
          <Tile label="Meetings" value={String(s.leads_meetings)} />
          <Tile
            label="Bounce rate"
            value={failed("replies") ? "Error" : s.emails_sent ? pct(hardBounces, s.emails_sent) : "No sends"}
            sub={hardBounces > 0 && s.emails_sent && hardBounces / s.emails_sent > 0.02 ? "Above 2%: clean the list" : `${s.emails_sent} emails sent`}
          />
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14 }}>
        <Card title="Funnel">
          {failed("stats") || !s ? (
            <ErrorBlock what="the funnel" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {funnel.map((f, i) => (
                <div key={f.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 92px", alignItems: "center", gap: 10 }} title={`${f.label}: ${f.value}`}>
                  <span style={{ fontSize: 12.5, color: COLORS.ink2 }}>{f.label}</span>
                  <div style={{ height: 22, background: COLORS.bgSoft, borderRadius: 6 }}>
                    <div style={{ height: "100%", width: `${Math.max(f.value ? 2 : 0, (f.value / funnelMax) * 100)}%`, background: REPLY_COLOR, opacity: 1 - i * 0.14, borderRadius: "0 4px 4px 0" }} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.ink0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {f.value.toLocaleString("en-US")}
                    {i > 0 && funnel[i - 1].value ? <span style={{ fontWeight: 500, color: COLORS.ink3 }}> · {pct(f.value, funnel[i - 1].value)}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="What came back">
          {failed("replies") ? (
            <ErrorBlock what="replies" />
          ) : report.replyBreakdown.length === 0 ? (
            <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>No replies yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {report.replyBreakdown.map((r) => (
                <div key={r.category} style={{ display: "grid", gridTemplateColumns: "150px 1fr 40px", alignItems: "center", gap: 10 }} title={`${BREAKDOWN_LABEL[r.category] ?? r.category}: ${r.count}`}>
                  <span style={{ fontSize: 12.5, color: COLORS.ink2 }}>{BREAKDOWN_LABEL[r.category] ?? r.category}</span>
                  <div style={{ height: 12, background: COLORS.bgSoft, borderRadius: 4 }}>
                    <div style={{ height: "100%", width: `${(r.count / breakdownMax) * 100}%`, background: SENT_COLOR, borderRadius: "0 4px 4px 0" }} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Daily activity" right={<span style={{ fontSize: 12, color: COLORS.ink3 }}>{campaign.settings.window.timezone}</span>}>
        {failed("sends") ? (
          <ErrorBlock what="daily sends" />
        ) : report.daily.length === 0 ? (
          <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>No emails sent yet.</div>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.daily} barGap={2} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.line} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: COLORS.lineStrong }}
                  tick={{ fontSize: 11, fill: COLORS.ink3 }}
                  tickFormatter={(d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  minTickGap={16}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: COLORS.ink3 }} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  contentStyle={{ borderRadius: 10, border: `1px solid ${COLORS.line}`, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
                  labelFormatter={(d) => new Date(`${String(d)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: COLORS.ink2 }} />
                <Bar dataKey="sent" name="Emails sent" fill={SENT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="replies" name="Replies" fill={REPLY_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Performance by step">
        {failed("steps") ? (
          <ErrorBlock what="step stats" />
        ) : (
          <table className="ds-table">
            <thead>
              <tr>
                <th>Step</th>
                <th style={{ textAlign: "right" }}>Sent / done</th>
                <th style={{ textAlign: "right" }}>Replies</th>
                <th>Reply rate</th>
                <th style={{ textAlign: "right" }}>Bounces</th>
              </tr>
            </thead>
            <tbody>
              {report.steps.map((st) => {
                const executed = st.kind === "email" ? st.sent : st.done;
                const rate = st.kind === "email" && st.sent ? st.replies / st.sent : null;
                return (
                  <tr key={st.step_id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <StepKindIcon kind={st.kind} size={24} />
                        <span style={{ fontWeight: 600 }}>
                          {st.position}. {STEP_KIND_META[st.kind].label}
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {executed}
                      {st.due ? <span style={{ color: COLORS.warn }}> · {st.due} to do</span> : null}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{st.kind === "email" ? st.replies : "n/a"}</td>
                    <td style={{ minWidth: 160 }}>
                      {rate === null ? (
                        <span style={{ color: COLORS.ink4 }}>n/a</span>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1, height: 8, background: COLORS.bgSoft, borderRadius: 4 }}>
                            <span style={{ display: "block", height: "100%", width: `${Math.min(100, rate * 400)}%`, background: REPLY_COLOR, borderRadius: "0 4px 4px 0" }} />
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 44, textAlign: "right" }}>{pct(st.replies, st.sent)}</span>
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", color: st.bounces ? COLORS.err : COLORS.ink3 }}>{st.kind === "email" ? st.bounces : "n/a"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div style={{ display: "flex", gap: 8, fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Contacted = received at least one email. Reply rate = human replies / contacted (auto-replies and bounces excluded). A reply counts for the last email sent before it.
          Meetings come from the &quot;Meeting booked&quot; outcome. No open tracking: it hurts deliverability and Apple Mail inflates it.
        </span>
      </div>
    </div>
  );
}
