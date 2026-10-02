"use client";

import { useState } from "react";
import { Calendar, Check, CheckCircle2, Database, Hash, Newspaper, RotateCcw, Video, Zap, FileText } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { InsightAction, InsightSource, Insights } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, Tag, daysAgo, fmtDay } from "./ui";

// "Next actions" de Key insights : 1 à 3 actions, la 1re mise en avant si elle
// est prioritaire. Chacune : titre impératif, owner, échéance, "Why" avec la
// source datée. "Done" la masque (PATCH /insights) ; les actions faites restent
// consultables ("N done") avec Reopen.

const DUE_LABEL: Record<NonNullable<InsightAction["due"]>, string> = {
  this_week: "This week",
  next_2_weeks: "Next 2 weeks",
  this_month: "This month",
};

const SOURCE_ICON = {
  claap: Video,
  hubspot: Database,
  slack: Hash,
  news: Newspaper,
  fiche: FileText,
} as const;

export function SourceLabel({ source }: { source: InsightSource | null | undefined }) {
  if (!source) return null;
  const Icon = SOURCE_ICON[source.kind] ?? FileText;
  const fallback = { claap: "Claap", hubspot: "HubSpot", slack: "Slack", news: "News", fiche: "Account page" }[source.kind];
  const label = source.label || fallback;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.ink1, fontWeight: 500 }}>
      <Icon size={12} style={{ color: COLORS.ink3 }} />
      {label}
      {source.date ? ` · ${fmtDay(source.date)}` : ""}
    </span>
  );
}

async function setDone(clientId: string, actionId: string, done: boolean) {
  const res = await fetch(`/api/clients/${clientId}/insights`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, done }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}

export function NextActionsCard({
  insights,
  clientId,
  onUpdated,
}: {
  insights: Insights | null;
  clientId: string;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [hiding, setHiding] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const all = insights?.actions ?? [];
  const open = all.filter((a) => !a.done_at && !(a.id && hiding.has(a.id))).slice(0, 3);
  const done = all.filter((a) => a.done_at);
  const doneThisWeek = done.filter((a) => (daysAgo(a.done_at) ?? 99) < 7).length;

  async function markDone(a: InsightAction) {
    if (!a.id) return;
    const id = a.id;
    setHiding((s) => new Set(s).add(id));
    try {
      await setDone(clientId, id, true);
      toast("Marked as done", "success");
      onUpdated();
    } catch (e) {
      setHiding((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  }

  async function reopen(a: InsightAction) {
    if (!a.id) return;
    try {
      await setDone(clientId, a.id, false);
      setHiding((s) => {
        const n = new Set(s);
        n.delete(a.id as string);
        return n;
      });
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  }

  return (
    <Card>
      <CardHeader
        icon={Zap}
        title="Next actions"
        meta={insights?.generated_at ? `Last 45 days · ${fmtDay(insights.generated_at)}` : undefined}
        style={{ marginBottom: 10 }}
      />

      {open.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.ink3, padding: "4px 0" }}>
          <CheckCircle2 size={14} style={{ color: COLORS.ok }} />
          No open action. The next refresh suggests new ones if something comes up.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {open.map((a, i) => {
            const top = i === 0 && a.priority === "high";
            const why = a.why ?? a.rationale;
            return (
              <div
                key={a.id ?? i}
                className="ch-act"
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "start",
                  padding: "11px 12px",
                  border: `1px solid ${top ? "#f8cddb" : COLORS.line}`,
                  borderRadius: 10,
                  background: top ? COLORS.brandTintSoft : COLORS.bgCard,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    background: top ? COLORS.brand : COLORS.ink0,
                    color: "#fff",
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, color: COLORS.ink0 }}>{a.title}</div>
                  {(a.owner || a.due) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {a.owner && <Tag>{a.owner}</Tag>}
                      {a.due && (
                        <Tag tone={a.due === "this_week" ? "err" : "neutral"}>
                          <Calendar size={11} />
                          {DUE_LABEL[a.due]}
                        </Tag>
                      )}
                    </div>
                  )}
                  {(why || a.source) && (
                    <div
                      title={why ?? undefined}
                      style={{
                        marginTop: 6,
                        fontSize: 12.5,
                        color: COLORS.ink2,
                        lineHeight: 1.45,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {why && (
                        <>
                          <b style={{ color: COLORS.ink1, fontWeight: 600 }}>Why:</b> {why}{" "}
                        </>
                      )}
                      <SourceLabel source={a.source} />
                    </div>
                  )}
                </div>
                {a.id ? (
                  <button type="button" className="ch-btn ch-btn-sm ch-btn-done" onClick={() => void markDone(a)}>
                    <Check size={13} />
                    Done
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: COLORS.ink3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CheckCircle2 size={13} />
            {doneThisWeek > 0 ? `${doneThisWeek} done this week` : `${done.length} done recently`} ·{" "}
            <button type="button" className="ch-link" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"}
            </button>
          </div>
          {showDone && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {done.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ textDecoration: "line-through", color: COLORS.ink3, flex: 1, minWidth: 0 }}>{a.title}</span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {fmtDay(a.done_at)}
                    {a.done_by ? ` · ${a.done_by.split("@")[0]}` : ""}
                  </span>
                  <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => void reopen(a)}>
                    <RotateCcw size={12} />
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
