"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { RotateCw, Send, ThumbsDown, X, ExternalLink } from "lucide-react";
import {
  RAG_CATEGORY_LABELS,
  RAG_VERDICT_LABELS,
  type RagCategory,
  type RagGapReport,
  type RagPendingState,
  type RagRow,
  type RagStats,
  type RagVerdict,
} from "@/lib/rag-insights/types";

// Le tableau se rafraîchit tout seul : une question posée apparaît d'elle-même,
// en attente d'analyse, sans avoir à relancer le juge. Seul le flux live est
// pollé vite ; les tours analysés ne bougent qu'au passage du juge.
const LIVE_REFRESH_MS = 15_000;
const ANALYSES_REFRESH_MS = 120_000;

type ApiResponse = {
  days: number;
  stats: RagStats;
  rows: RagRow[];
  names: Record<string, string>;
  report: RagGapReport | null;
  reportMeta: { created_at: string; slack_sent_at: string | null; slack_recipients: string | null } | null;
  meta: { status: string; started_at: string | null; finished_at: string | null; error_message: string | null; analyzed_count: number | null } | null;
};

/** Réponse de /api/admin/rag/live : les questions pas encore jugées. */
type LiveResponse = { days: number; pending: RagRow[] };

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

const COLORS = {
  ink: "#111",
  ink2: "#666",
  ink3: "#888",
  ink4: "#aaa",
  line: "#e5e5e5",
  bg: "#fafafa",
  accent: "#f01563",
};

function scoreColor(score: number | null): string {
  if (score === null) return COLORS.ink4;
  if (score >= 80) return "#12855b";
  if (score >= 60) return "#b06a00";
  return "#c02b2b";
}

const VERDICT_TONE: Record<RagVerdict, { bg: string; fg: string }> = {
  answered: { bg: "#e8f5ee", fg: "#12855b" },
  partial: { bg: "#fdf3e2", fg: "#b06a00" },
  missing_info: { bg: "#fdecec", fg: "#c02b2b" },
  wrong: { bg: "#fbe4e4", fg: "#9c1414" },
  off_scope: { bg: "#f1f1f1", fg: "#777" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Une question qui vient d'arriver se lit mieux en relatif qu'en date. */
function fmtWhen(iso: string) {
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  return fmtDate(iso);
}

function sinceLabel(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Petits blocs ─────────────────────────────────────────────────────────────

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-3.5"
      style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: COLORS.ink4 }}>
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1" style={{ color: tone ?? COLORS.ink }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11.5px] mt-0.5" style={{ color: COLORS.ink3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const PENDING_LABELS: Record<RagPendingState, string> = {
  answering: "Answering…",
  analyzing: "Awaiting analysis",
};

function Badge({ row }: { row: Pick<RagRow, "verdict" | "pending"> }) {
  if (row.pending) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
        style={{ background: "#eef2ff", color: "#4f46e5" }}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${row.pending === "answering" ? "animate-pulse" : ""}`}
          style={{ background: "#4f46e5" }}
        />
        {PENDING_LABELS[row.pending]}
      </span>
    );
  }
  if (!row.verdict) return null;
  const tone = VERDICT_TONE[row.verdict] ?? VERDICT_TONE.off_scope;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {RAG_VERDICT_LABELS[row.verdict] ?? row.verdict}
    </span>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-xl p-1" style={{ background: "#f5f5f5" }}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{
            background: value === o.v ? "#111" : "transparent",
            color: value === o.v ? "#fff" : COLORS.ink2,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Onglet Overview ──────────────────────────────────────────────────────────

function Overview({ stats, pendingCount }: { stats: RagStats; pendingCount: number }) {
  const maxCount = Math.max(1, ...stats.byCategory.map((c) => c.count));
  const knowledgeShare = stats.total > 0 ? Math.round((stats.knowledge / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile
          label="Questions"
          value={String(stats.total)}
          sub={
            `${stats.web} web / ${stats.slack} Slack` +
            (pendingCount > 0 ? ` · +${pendingCount} not analyzed` : "")
          }
        />
        <Tile label="Knowledge" value={`${knowledgeShare}%`} sub={`${stats.knowledge} questions on Notion`} />
        <Tile
          label="Satisfaction"
          value={stats.avgSatisfaction !== null ? `${stats.avgSatisfaction}` : "n/a"}
          sub={stats.avgKnowledgeSatisfaction !== null ? `${stats.avgKnowledgeSatisfaction} on knowledge` : undefined}
          tone={scoreColor(stats.avgSatisfaction)}
        />
        <Tile
          label="Unanswered"
          value={String(stats.unanswered)}
          sub="missing info or wrong"
          tone={stats.unanswered > 0 ? "#c02b2b" : undefined}
        />
        <Tile
          label="Thumbs down"
          value={String(stats.thumbsDown)}
          sub="explicit user feedback"
          tone={stats.thumbsDown > 0 ? "#c02b2b" : undefined}
        />
      </div>

      <div className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: COLORS.ink }}>
          Categories
        </h2>
        {stats.byCategory.length === 0 ? (
          <p className="text-[13px]" style={{ color: COLORS.ink3 }}>
            No question analyzed on this period yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {stats.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <div className="w-48 shrink-0 text-[12.5px]" style={{ color: COLORS.ink2 }}>
                  {RAG_CATEGORY_LABELS[c.category as RagCategory] ?? c.category}
                </div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#f2f2f2" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(c.count / maxCount) * 100}%`, background: COLORS.accent }}
                  />
                </div>
                <div className="w-10 text-right text-[12.5px] font-semibold" style={{ color: COLORS.ink }}>
                  {c.count}
                </div>
                <div
                  className="w-16 text-right text-[12px] font-medium"
                  style={{ color: scoreColor(c.avgSatisfaction) }}
                >
                  {c.avgSatisfaction !== null ? `${c.avgSatisfaction}/100` : "n/a"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Onglet Questions ─────────────────────────────────────────────────────────

function Questions({
  rows,
  names,
  onSelect,
}: {
  rows: RagRow[];
  names: Record<string, string>;
  onSelect: (row: RagRow) => void;
}) {
  const [source, setSource] = useState<"all" | "web" | "slack">("all");
  const [verdict, setVerdict] = useState<"all" | "pending" | RagVerdict>("all");
  const [downOnly, setDownOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (source !== "all" && r.source !== source) return false;
      if (verdict === "pending" ? !r.pending : verdict !== "all" && r.verdict !== verdict) return false;
      if (downOnly && !(r.satisfaction_basis === "explicit" && (r.satisfaction ?? 100) <= 30)) return false;
      if (needle && !r.question.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, source, verdict, downOnly, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Seg
          value={source}
          options={[
            { v: "all" as const, label: "All" },
            { v: "web" as const, label: "Web" },
            { v: "slack" as const, label: "Slack" },
          ]}
          onChange={setSource}
        />
        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value as "all" | "pending" | RagVerdict)}
          className="text-xs rounded-lg px-3 py-2"
          style={{ border: `1px solid ${COLORS.line}`, background: "#fff", color: COLORS.ink2 }}
        >
          <option value="all">All verdicts</option>
          <option value="pending">Not analyzed yet</option>
          {(Object.keys(RAG_VERDICT_LABELS) as RagVerdict[]).map((v) => (
            <option key={v} value={v}>
              {RAG_VERDICT_LABELS[v]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setDownOnly((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 font-medium transition-colors"
          style={{
            border: `1px solid ${downOnly ? "#c02b2b" : COLORS.line}`,
            background: downOnly ? "#fdecec" : "#fff",
            color: downOnly ? "#c02b2b" : COLORS.ink2,
          }}
        >
          <ThumbsDown size={13} />
          Thumbs down only
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a question…"
          className="text-xs rounded-lg px-3 py-2 flex-1 min-w-[180px]"
          style={{ border: `1px solid ${COLORS.line}`, background: "#fff", color: COLORS.ink }}
        />
        <span className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
        {filtered.length === 0 ? (
          <p className="text-[13px] p-5" style={{ color: COLORS.ink3 }}>
            Nothing matches these filters.
          </p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: COLORS.bg, color: COLORS.ink3 }}>
                <th className="text-left font-medium px-4 py-2.5">Date</th>
                <th className="text-left font-medium px-2 py-2.5">Who</th>
                <th className="text-left font-medium px-2 py-2.5">Question</th>
                <th className="text-left font-medium px-2 py-2.5">Category</th>
                <th className="text-left font-medium px-2 py-2.5">Verdict</th>
                <th className="text-right font-medium px-4 py-2.5">Score</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="cursor-pointer transition-colors hover:bg-[#fafafa]"
                  style={{ borderTop: `1px solid ${COLORS.line}` }}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: COLORS.ink3 }}>
                    {fmtWhen(r.asked_at)}
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: COLORS.ink2 }}>
                    {r.user_id ? (names[r.user_id] ?? "Unknown") : "Unknown"}
                    <span style={{ color: COLORS.ink4 }}> · {r.source}</span>
                  </td>
                  <td className="px-2 py-2.5" style={{ color: COLORS.ink }}>
                    <span className="line-clamp-1">{r.question}</span>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: COLORS.ink2 }}>
                    {r.category ? (RAG_CATEGORY_LABELS[r.category] ?? r.category) : "-"}
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge row={r} />
                  </td>
                  <td
                    className="px-4 py-2.5 text-right font-semibold whitespace-nowrap"
                    style={{ color: scoreColor(r.satisfaction) }}
                  >
                    {r.satisfaction ?? "-"}
                    {r.satisfaction_basis === "explicit" && (
                      <span title="explicit user feedback"> ●</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Drawer de détail ─────────────────────────────────────────────────────────

function DetailDrawer({
  row,
  names,
  onClose,
}: {
  row: RagRow;
  names: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.25)" }} onClick={onClose}>
      <div
        className="w-full max-w-[560px] h-full overflow-y-auto p-6"
        style={{ background: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
              {fmtDate(row.asked_at)} · {row.source} ·{" "}
              {row.user_id ? (names[row.user_id] ?? "Unknown") : "Unknown"}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge row={row} />
              {row.pending ? (
                <span className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
                  {row.pending === "answering"
                    ? "the answer is still being written"
                    : "scored on the next analysis run"}
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold" style={{ color: scoreColor(row.satisfaction) }}>
                    {row.satisfaction ?? "-"}/100
                  </span>
                  <span className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
                    {row.satisfaction_basis === "explicit" ? "explicit feedback" : "inferred"}
                  </span>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ color: COLORS.ink3 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <Section title="Question">
          <p style={{ color: COLORS.ink }}>{row.question}</p>
        </Section>

        {row.answer_summary && (
          <Section title="Answer summary">
            <p style={{ color: COLORS.ink2 }}>{row.answer_summary}</p>
          </Section>
        )}

        {row.issue && (
          <Section title="What went wrong">
            <p style={{ color: "#c02b2b" }}>{row.issue}</p>
          </Section>
        )}

        {row.gap_summary && (
          <Section title="Missing from Notion">
            <p style={{ color: COLORS.ink2 }}>{row.gap_summary}</p>
          </Section>
        )}

        {row.notion_pages?.length > 0 && (
          <Section title="Notion pages read">
            <ul className="space-y-1">
              {row.notion_pages.map((p, i) => (
                <li key={i}>
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: COLORS.accent }}
                    >
                      {p.title}
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span style={{ color: COLORS.ink2 }}>{p.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {row.guides_loaded?.length > 0 && (
          <Section title="Guides loaded">
            <p style={{ color: COLORS.ink2 }}>{row.guides_loaded.join(", ")}</p>
          </Section>
        )}

        {row.answer_excerpt && (
          <Section title="Full answer (excerpt)">
            <p className="whitespace-pre-wrap" style={{ color: COLORS.ink2 }}>
              {row.answer_excerpt}
            </p>
          </Section>
        )}

        {row.reasoning && (
          <Section title="Judge reasoning">
            <p style={{ color: COLORS.ink3 }}>{row.reasoning}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: COLORS.ink4 }}>
        {title}
      </h3>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}

// ── Onglet Notion gaps ───────────────────────────────────────────────────────

function Gaps({ report }: { report: RagGapReport | null }) {
  if (!report || (report.gaps.length === 0 && report.new_pages.length === 0 && report.quick_wins.length === 0)) {
    return (
      <div className="rounded-2xl p-5 text-[13px]" style={{ background: "#fff", border: `1px solid ${COLORS.line}`, color: COLORS.ink3 }}>
        No gap report yet. Run the analysis to build one.
      </div>
    );
  }

  const priorityTone: Record<string, { bg: string; fg: string }> = {
    high: { bg: "#fdecec", fg: "#c02b2b" },
    medium: { bg: "#fdf3e2", fg: "#b06a00" },
    low: { bg: "#f1f1f1", fg: "#777" },
  };

  return (
    <div className="space-y-6">
      {report.gaps.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: COLORS.ink }}>
            Knowledge base gaps
          </h2>
          {report.gaps.map((gap, i) => {
            const tone = priorityTone[gap.priority] ?? priorityTone.low;
            return (
              <div key={i} className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[14px] font-semibold" style={{ color: COLORS.ink }}>
                    {gap.theme}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      {gap.priority}
                    </span>
                    <span className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
                      {gap.question_count} question{gap.question_count > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                <p className="text-[13px] mt-2" style={{ color: COLORS.ink2 }}>
                  {gap.missing}
                </p>

                <p className="text-[12.5px] mt-2 font-medium" style={{ color: COLORS.accent }}>
                  {gap.action === "create_page" ? "→ create a page" : "→ enrich an existing page"}
                </p>

                {gap.existing_pages?.length > 0 && (
                  <div className="text-[12px] mt-2" style={{ color: COLORS.ink3 }}>
                    Pages concerned:{" "}
                    {gap.existing_pages.map((p, j) => (
                      <span key={j}>
                        {j > 0 && ", "}
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: COLORS.ink2 }}>
                            {p.title}
                          </a>
                        ) : (
                          p.title
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {gap.sample_questions?.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {gap.sample_questions.map((q, j) => (
                      <li key={j} className="text-[12.5px] pl-3" style={{ color: COLORS.ink3, borderLeft: `2px solid ${COLORS.line}` }}>
                        {q}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {report.new_pages.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: COLORS.ink }}>
            New page ideas
          </h2>
          <div className="grid md:grid-cols-2 gap-3">
            {report.new_pages.map((page, i) => (
              <div key={i} className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                <h3 className="text-[13.5px] font-semibold" style={{ color: COLORS.ink }}>
                  {page.title}
                </h3>
                <p className="text-[11.5px] mt-0.5" style={{ color: COLORS.ink4 }}>
                  under {page.parent_section} · {page.priority} priority
                </p>
                <p className="text-[12.5px] mt-2" style={{ color: COLORS.ink2 }}>
                  {page.why}
                </p>
                {page.outline?.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {page.outline.map((o, j) => (
                      <li key={j} className="text-[12.5px]" style={{ color: COLORS.ink3 }}>
                        · {o}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.quick_wins.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: COLORS.ink }}>
            Quick wins
          </h2>
          <ul className="space-y-1.5">
            {report.quick_wins.map((w, i) => (
              <li key={i} className="text-[12.5px]" style={{ color: COLORS.ink2 }}>
                · {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function RagDashboard() {
  const [days, setDays] = useState(30);
  const { data, isLoading, mutate } = useSWR<ApiResponse>(`/api/admin/rag?days=${days}`, fetcher, {
    refreshInterval: ANALYSES_REFRESH_MS,
    keepPreviousData: true,
  });
  // Flux live : SWR met le timer en pause quand l'onglet n'est pas visible.
  const { data: live, mutate: mutateLive } = useSWR<LiveResponse>(`/api/admin/rag/live?days=${days}`, fetcher, {
    refreshInterval: LIVE_REFRESH_MS,
    keepPreviousData: true,
  });
  const [tab, setTab] = useState<"overview" | "questions" | "gaps">("overview");
  const [selected, setSelected] = useState<RagRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = refreshing || data?.meta?.status === "running";

  async function onRefresh() {
    if (isRunning) return;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await fetch("/api/admin/rag/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDays: days }),
      });
    } catch {
      // le polling ci-dessous reflètera l'état réel
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      const [fresh] = await Promise.all([mutate(), mutateLive()]);
      const status = fresh?.meta?.status;
      if (status === "done" || status === "error" || Date.now() - startedAt > 10 * 60_000) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setRefreshing(false);
      }
    }, 5000);
  }

  async function onSendRecap() {
    if (sending === "pending") return;
    setSending("pending");
    try {
      const res = await fetch("/api/admin/rag/send-recap", { method: "POST" });
      const body = (await res.json()) as { sent?: boolean; recipients?: string[]; reason?: string };
      setSending(
        body.sent ? `Sent to ${body.recipients?.join(", ")}` : `Not sent: ${body.reason ?? "unknown"}`,
      );
    } catch {
      setSending("Send failed");
    }
    void mutate();
    setTimeout(() => setSending(null), 6000);
  }

  const stats = data?.stats;

  // Le flux live et les analyses sont deux requêtes : tant qu'elles ne portent
  // pas sur la même fenêtre, on ignore les pending pour ne pas mélanger.
  const pending = useMemo(
    () => (live && live.days === days ? live.pending : []),
    [live, days],
  );
  // Une seule liste pour le tableau : les questions en attente d'analyse se
  // rangent avec les autres, du plus récent au plus ancien. Un tour analysé
  // entre deux polls peut être dans les deux listes : la version jugée gagne.
  const questionRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const analyzed = new Set(rows.map((r) => `${r.source}::${r.source_id}::${r.turn_index}`));
    const stillPending = pending.filter(
      (r) => !analyzed.has(`${r.source}::${r.source_id}::${r.turn_index}`),
    );
    return [...stillPending, ...rows].sort((a, b) => b.asked_at.localeCompare(a.asked_at));
  }, [pending, data?.rows]);

  const pendingCount = questionRows.filter((r) => r.pending).length;

  return (
    <div className="p-6 md:p-8 max-w-[1240px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold" style={{ color: COLORS.ink }}>
              RAG Insights
            </h1>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ background: "#e8f5ee", color: "#12855b" }}
              title={`Questions show up here as they are asked. Refreshed every ${LIVE_REFRESH_MS / 1000}s.`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "#12855b" }}
              />
              Live
            </span>
          </div>
          <p className="text-[13px] mt-0.5" style={{ color: COLORS.ink3 }}>
            What the team asks CoachelloGPT, how well it answers, and where the Notion base is
            missing content. Web chat and Slack.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={onSendRecap}
              disabled={sending === "pending"}
              className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-opacity"
              style={{
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                color: COLORS.ink2,
                opacity: sending === "pending" ? 0.6 : 1,
              }}
            >
              <Send size={15} />
              {sending === "pending" ? "Sending…" : "Send Slack recap"}
            </button>
            <button
              onClick={onRefresh}
              disabled={isRunning}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity"
              style={{
                background: COLORS.accent,
                opacity: isRunning ? 0.6 : 1,
                cursor: isRunning ? "default" : "pointer",
              }}
            >
              <RotateCw size={16} className={isRunning ? "animate-spin" : ""} />
              {isRunning ? "Analyzing…" : "Refresh analysis"}
            </button>
          </div>
          <span className="text-[11px]" style={{ color: COLORS.ink4 }}>
            {sending && sending !== "pending"
              ? sending
              : `Last analysis: ${sinceLabel(data?.meta?.finished_at)}` +
                (data?.reportMeta?.slack_sent_at
                  ? ` · recap sent ${sinceLabel(data.reportMeta.slack_sent_at)}`
                  : "")}
          </span>
          {data?.meta?.status === "error" && data.meta.error_message && (
            <span className="text-[11px]" style={{ color: "#c02b2b" }}>
              Last run failed: {data.meta.error_message}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Seg
          value={tab}
          options={[
            { v: "overview" as const, label: "Overview" },
            {
              v: "questions" as const,
              label: pendingCount > 0 ? `Questions · ${pendingCount} new` : "Questions",
            },
            { v: "gaps" as const, label: "Notion gaps" },
          ]}
          onChange={setTab}
        />
        <Seg
          value={days}
          options={[
            { v: 7, label: "7d" },
            { v: 30, label: "30d" },
            { v: 90, label: "90d" },
          ]}
          onChange={setDays}
        />
      </div>

      {isLoading && !data ? (
        <p className="text-[13px]" style={{ color: COLORS.ink3 }}>
          Loading…
        </p>
      ) : (
        <>
          {tab === "overview" && stats && <Overview stats={stats} pendingCount={pendingCount} />}
          {tab === "questions" && (
            <Questions rows={questionRows} names={data?.names ?? {}} onSelect={setSelected} />
          )}
          {tab === "gaps" && <Gaps report={data?.report ?? null} />}
        </>
      )}

      {selected && (
        <DetailDrawer row={selected} names={data?.names ?? {}} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
