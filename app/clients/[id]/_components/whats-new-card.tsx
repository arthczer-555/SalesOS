"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Loader2, Undo2, Video, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import type { AccountCompany, ClientFields, Insights, RefreshReport, RefreshSourceStat } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { SourceLabel } from "./next-actions-card";
import { Card, CardHeader, Eyebrow, Tag, fmtDay } from "./ui";

// Knowledge > Recent activity : ce qui a changé récemment (faits clés tirés
// par l'IA, meetings Claap ajoutés tout seuls), avec la source. Activité
// interne seulement : les news ont leur carte. Plus de version courte dans Key
// insights (retirée le 2026-10-08, doublon avec cette carte).
// Le détail du dernier refresh (compteurs par source, champs modifiés + Undo)
// vit dans RefreshReportModal, ouvert depuis le petit lien du header.

type FeedItem = { key: string; date: string | null; source: React.ReactNode; text: React.ReactNode };

function stringify(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) {
    if (value.length === 0) return "empty";
    return value
      .map((v) => (v && typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).title ?? JSON.stringify(v)) : String(v)))
      .join(", ");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("enabled" in o) return o.enabled ? (o.details ? `Yes, ${String(o.details)}` : "Yes") : "No";
    if ("name" in o) return String(o.name);
    return JSON.stringify(o);
  }
  return String(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function useDeclineMeeting(clientId: string, onUpdated: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function decline(recordingId: string, title: string | null) {
    setBusy(recordingId);
    try {
      const res = await fetch(`/api/clients/${clientId}/decline-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_id: recordingId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast(`"${title ?? "Meeting"}" removed. Refreshing without it.`, "success");
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the meeting", "error");
    } finally {
      setBusy(null);
    }
  }
  return { busy, decline };
}

function buildFeed(
  insights: Insights | null,
  report: RefreshReport | null,
  decline: { busy: string | null; decline: (id: string, title: string | null) => Promise<void> },
): FeedItem[] {
  const feed: FeedItem[] = [];
  for (const [i, h] of (insights?.highlights ?? []).entries()) {
    if (h.source?.kind === "news") continue;
    feed.push({ key: `h${i}`, date: h.date ?? h.source?.date ?? null, source: <SourceLabel source={h.source ? { ...h.source, date: null } : null} />, text: h.text });
  }
  if (!insights?.highlights?.length) {
    for (const [i, o] of (insights?.observations ?? []).entries()) {
      feed.push({ key: `o${i}`, date: null, source: <span style={{ color: COLORS.ink3 }}>Observation</span>, text: o });
    }
  }
  for (const m of report?.auto_added_meetings ?? []) {
    feed.push({
      key: `m${m.recording_id}`,
      date: m.meeting_started_at,
      source: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500, color: COLORS.ink1 }}>
          <Video size={12} style={{ color: COLORS.ink3 }} />
          Claap
        </span>
      ),
      text: (
        <>
          &quot;{m.meeting_title ?? "Untitled meeting"}&quot; added automatically ·{" "}
          <button type="button" className="ch-link" disabled={decline.busy === m.recording_id} onClick={() => void decline.decline(m.recording_id, m.meeting_title)}>
            {decline.busy === m.recording_id ? "Removing…" : "Not this account?"}
          </button>
        </>
      ),
    });
  }
  feed.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
  return feed;
}

export function WhatsNewCard({
  insights,
  report,
  clientId,
  onUpdated,
  id,
}: {
  insights: Insights | null;
  report: RefreshReport | null;
  clientId: string;
  onUpdated: () => void;
  id?: string;
}) {
  const decline = useDeclineMeeting(clientId, onUpdated);
  const feed = buildFeed(insights, report, decline);

  return (
    <Card id={id}>
      <CardHeader
        icon={Activity}
        title="Recent activity"
        meta={report?.refreshed_at ? `Since ${fmtDay(report.refreshed_at)}` : undefined}
      />
      {feed.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.ink3 }}>Nothing new yet. The weekly refresh fills this every Monday.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {feed.map((f, i) => (
            <div
              key={f.key}
              style={{
                display: "grid",
                gridTemplateColumns: "60px minmax(120px, 170px) minmax(0, 1fr)",
                gap: 12,
                padding: "10px 0",
                borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}`,
                paddingTop: i === 0 ? 0 : 10,
                alignItems: "baseline",
                fontSize: 13,
              }}
            >
              <span style={{ fontSize: 12, color: COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>{f.date ? fmtDay(f.date) : ""}</span>
              <span style={{ fontSize: 12, minWidth: 0 }}>{f.source}</span>
              <span style={{ color: COLORS.ink0, minWidth: 0 }}>{f.text}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SourceStat({ label, stat, suffix }: { label: string; stat: RefreshSourceStat | undefined; suffix?: string }) {
  if (!stat) return null;
  if (stat.error) {
    return (
      <Tag tone="warn" title={stat.error}>
        <AlertTriangle size={11} />
        {label}: not reachable
      </Tag>
    );
  }
  return (
    <Tag>
      {stat.new} {label}
      {suffix ? ` ${suffix}` : ""}
    </Tag>
  );
}

// Popup "Last refresh" : compteurs par source, champs modifiés (avant / après,
// Undo), notes. Ouvert depuis le petit lien "details" sous le bouton Refresh.
export function RefreshReportModal({
  report,
  fields,
  clientId,
  accountCompanies,
  onUpdated,
  onRefreshStarted,
  onClose,
}: {
  report: RefreshReport | null;
  fields: Partial<ClientFields>;
  clientId: string;
  // Companies rattachées au compte : retirables d'ici (même route que le
  // panneau de la fiche), y compris après un Keep.
  accountCompanies?: AccountCompany[] | null;
  onUpdated: () => void;
  onRefreshStarted?: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const accountIds = new Set((accountCompanies ?? []).map((c) => c.id));

  async function removeCompany(c: { id: string; name: string | null; domain: string | null }) {
    setBusy(`co:${c.id}`);
    try {
      const res = await fetch(`/api/clients/${clientId}/account-company`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: c.id, action: "remove" }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast(`${c.name || c.domain || "Company"} removed. Refreshing without it.`, "success");
      onRefreshStarted?.();
      onUpdated();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the company", "error");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function undoChange(c: RefreshReport["changed_fields"][number]) {
    const key = `${c.section}.${c.key}`;
    setBusy(key);
    try {
      const res = await fetch(`/api/clients/${clientId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey: c.section, fieldKey: c.key, value: c.before ?? null }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast(`${c.label} restored`, "success");
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not restore", "error");
    } finally {
      setBusy(null);
    }
  }

  const changes = report?.changed_fields ?? [];

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 620, background: COLORS.bgCard, borderRadius: 16, boxShadow: SHADOWS.pop, padding: 22, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h3 id="report-title" style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Last refresh</h3>
            {report && (
              <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2 }}>
                {new Date(report.refreshed_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {report.trigger === "cron" ? " · weekly run" : " · manual"}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {!report ? (
          <p style={{ fontSize: 13, color: COLORS.ink3 }}>This account has not been refreshed yet.</p>
        ) : report.error ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: COLORS.err, marginTop: 14 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <b>The refresh failed.</b> The page shows the previous data. {report.error}
            </span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
              {report.sources ? (
                <>
                  <SourceStat label="Claap" stat={report.sources.claap} suffix="meetings" />
                  <SourceStat label="HubSpot" stat={report.sources.hubspot} suffix="activities" />
                  <SourceStat label="Slack" stat={report.sources.slack} suffix="messages" />
                  <SourceStat label="News" stat={report.sources.news} suffix="important" />
                </>
              ) : (
                <Tag>{report.new_activity_count} new activities</Tag>
              )}
            </div>
            {report.sources?.slack?.channel && (
              <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>Slack channels read: {report.sources.slack.channel}, #12-everything-clients</div>
            )}
            {!!report.sources?.hubspot?.deals?.length && (
              <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
                {`HubSpot deals read: ${report.sources.hubspot.deals
                  .map((d) => `${d.name || d.id}${d.pipeline_label ? ` (${d.pipeline_label})` : ""}`)
                  .join(", ")}`}
              </div>
            )}
            {!!report.sources?.hubspot?.companies?.length && (
              <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
                HubSpot companies read:{" "}
                {report.sources.hubspot.companies.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    {c.name || c.domain || c.id}
                    {accountIds.has(c.id) && (
                      <>
                        {" ("}
                        <button
                          type="button"
                          className="ch-link"
                          style={{ fontSize: 12 }}
                          disabled={busy !== null}
                          onClick={() => void removeCompany(c)}
                        >
                          {busy === `co:${c.id}` ? "removing…" : "remove"}
                        </button>
                        {")"}
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <Eyebrow style={{ marginBottom: 6 }}>
                {changes.length > 0 ? `${changes.length} field${changes.length > 1 ? "s" : ""} updated` : "Fields"}
              </Eyebrow>
              {changes.length === 0 ? (
                <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>
                  {report.skipped_no_activity ? "No new activity, so the fields were not re-analyzed." : "No field changed."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {changes.map((c) => {
                    const current = (fields as Record<string, Record<string, { value?: unknown }> | undefined>)[c.section]?.[c.key]?.value;
                    const canUndo = "before" in c;
                    const restored = canUndo && same(current, c.before) && !same(c.before, c.after);
                    const key = `${c.section}.${c.key}`;
                    return (
                      <div
                        key={key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(110px, 170px) minmax(0, 1fr) auto",
                          gap: 10,
                          alignItems: "center",
                          fontSize: 12.5,
                          opacity: restored ? 0.55 : 1,
                        }}
                      >
                        <span style={{ color: COLORS.ink2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {c.label}
                          {c.overrode_manual && (
                            <Tag tone="warn" title="This field had been edited by hand. A more recent source replaced it.">
                              replaced a manual edit
                            </Tag>
                          )}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          {canUndo ? (
                            <>
                              <del style={{ color: COLORS.ink3 }}>{stringify(c.before)}</del>
                              <span style={{ color: COLORS.ink4, margin: "0 6px" }}>→</span>
                              <span style={{ fontWeight: 600 }}>{stringify(restored ? c.before : c.after)}</span>
                            </>
                          ) : (
                            <span style={{ color: COLORS.ink3 }}>updated</span>
                          )}
                        </span>
                        {restored ? (
                          <span style={{ fontSize: 12, color: COLORS.ink3 }}>Restored</span>
                        ) : canUndo ? (
                          <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" disabled={busy === key} onClick={() => void undoChange(c)}>
                            {busy === key ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                            Undo
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {(report.notes ?? []).map((n, i) => (
              <div key={i} style={{ marginTop: 10, fontSize: 12, color: COLORS.warn, display: "flex", gap: 6 }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                {n}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
