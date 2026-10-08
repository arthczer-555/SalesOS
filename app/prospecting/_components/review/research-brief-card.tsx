"use client";

import * as React from "react";
import {
  AlertTriangle,
  Ban,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { COLORS, scoreToColor } from "@/lib/design/tokens";
import { researchEnrollment } from "@/lib/hooks/use-prospecting-review";
import type { ContactResearch, ContactRow, HookKind, ResearchHook } from "@/lib/prospecting/types";
import { timeAgo } from "../shared/format";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const HOOK_META: Record<HookKind, { icon: IconType; label: string; color: string }> = {
  post: { icon: MessageSquare, label: "LinkedIn post", color: "#0a66c2" },
  news: { icon: Newspaper, label: "News", color: COLORS.info },
  hiring: { icon: Briefcase, label: "Hiring", color: COLORS.ok },
  career: { icon: TrendingUp, label: "Career", color: COLORS.brand },
  crm: { icon: Database, label: "CRM", color: COLORS.warn },
  company: { icon: Building2, label: "Company", color: COLORS.ink2 },
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink3 }}>{children}</div>;
}

function StrengthDots({ value }: { value: 1 | 2 | 3 }) {
  return (
    <span title={`Hook strength ${value}/3`} style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3].map((i) => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: 999, background: i <= value ? COLORS.brand : COLORS.line }} />
      ))}
    </span>
  );
}

function HookRow({ hook }: { hook: ResearchHook }) {
  const meta = HOOK_META[hook.kind] ?? HOOK_META.company;
  const Icon = meta.icon;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0" }}>
      <span
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: `${meta.color}14`,
          color: meta.color,
        }}
      >
        <Icon size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.45 }}>{hook.text}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 11.5, color: COLORS.ink3, flexWrap: "wrap" }}>
          <span>{meta.label}</span>
          {hook.date ? <span>· {hook.date}</span> : null}
          <StrengthDots value={hook.strength} />
          {hook.sourceUrl ? (
            <a
              href={hook.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0a66c2", textDecoration: "none", fontWeight: 600 }}
            >
              Source <ExternalLink size={10} />
            </a>
          ) : (
            <span style={{ color: COLORS.ink4 }}>no link</span>
          )}
        </div>
      </div>
    </div>
  );
}

function FitMeter({ score, reason }: { score: number; reason: string }) {
  const c = scoreToColor(score, 100);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Eyebrow>Persona fit</Eyebrow>
        <span style={{ fontSize: 13, fontWeight: 800, color: c.fg, fontVariantNumeric: "tabular-nums" }}>{score}/100</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: COLORS.line, marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: c.fg, borderRadius: 999, transition: "width 0.3s" }} />
      </div>
      {reason ? <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 6, lineHeight: 1.45 }}>{reason}</div> : null}
    </div>
  );
}

// Brief de recherche d'un prospect : accroches sourcées, douleurs, fit persona,
// sources en échec (jamais masquées) et rafraîchissement manuel.
export function ResearchBriefCard({ contact, enrollmentId, onRefreshed }: { contact: ContactRow; enrollmentId?: string; onRefreshed?: () => void }) {
  const { toast } = useToast();
  const [research, setResearch] = React.useState<ContactResearch | null>(contact.research);
  const [researchAt, setResearchAt] = React.useState<string | null>(contact.research_at);
  const [busy, setBusy] = React.useState(false);
  const [showSources, setShowSources] = React.useState(false);

  React.useEffect(() => {
    setResearch(contact.research);
    setResearchAt(contact.research_at);
  }, [contact.id, contact.research, contact.research_at]);

  const refresh = async () => {
    if (!enrollmentId) return;
    setBusy(true);
    try {
      const r = await researchEnrollment(enrollmentId, true);
      setResearch(r);
      setResearchAt(r.fetchedAt);
      toast(r.brief ? "Research refreshed" : "Research refreshed, but the AI brief failed", r.brief ? "success" : "error");
      onRefreshed?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Research failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const brief = research?.brief ?? null;
  const errors = research?.errors ?? [];
  const sources = (research?.sources ?? []).filter((s) => s.url);

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: COLORS.brandTint, color: COLORS.brand }}>
        <Sparkles size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>Research brief</div>
        <div style={{ fontSize: 12, color: COLORS.ink3 }}>{researchAt ? `Researched ${timeAgo(researchAt)}` : "Not researched yet"}</div>
      </div>
      {enrollmentId ? (
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={() => void refresh()}>
          {research ? "Refresh research" : "Run research"}
        </Button>
      ) : null}
    </div>
  );

  if (!research) {
    return (
      <div className="ds-card" style={{ padding: 14 }}>
        {header}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, padding: 12, borderRadius: 12, background: COLORS.bgSoft, fontSize: 13, color: COLORS.ink2 }}>
          <Search size={15} style={{ color: COLORS.ink3, flexShrink: 0 }} />
          {busy
            ? "Reading LinkedIn, news, job posts and CRM history. This takes up to a minute."
            : "Research runs automatically when messages are generated: LinkedIn profile and posts, company news, open sales roles and CRM history."}
        </div>
      </div>
    );
  }

  return (
    <div className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      {header}

      {brief ? (
        <>
          {brief.summary ? <div style={{ fontSize: 13.5, color: COLORS.ink1, lineHeight: 1.55 }}>{brief.summary}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 18 }}>
            <div>
              <Eyebrow>Hooks</Eyebrow>
              {brief.hooks.length ? (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {brief.hooks.map((h, i) => (
                    <HookRow key={i} hook={h} />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 6 }}>No specific hook found. Messages stay on the persona problem, without invented facts.</div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <FitMeter score={brief.personaFit.score} reason={brief.personaFit.reason} />
              {brief.pains.length ? (
                <div>
                  <Eyebrow>Likely pains</Eyebrow>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                    {brief.pains.map((p, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: COLORS.ink1, lineHeight: 1.45, paddingLeft: 10, borderLeft: `2px solid ${COLORS.brandTint}` }}>
                        {p}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {brief.suggestedAngle ? (
                <div>
                  <Eyebrow>Suggested angle</Eyebrow>
                  <div style={{ fontSize: 12.5, color: COLORS.ink1, marginTop: 5, lineHeight: 1.45 }}>{brief.suggestedAngle}</div>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Tag tone="info" size="sm">
                  Writes in {brief.language === "fr" ? "French" : "English"}
                </Tag>
              </div>
            </div>
          </div>

          {brief.doNotMention.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: COLORS.warn }}>
                <Ban size={12} /> Don&apos;t mention
              </span>
              {brief.doNotMention.map((d, i) => (
                <Tag key={i} tone="warn" size="sm">
                  {d}
                </Tag>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ fontSize: 13, color: COLORS.err, display: "flex", gap: 8, alignItems: "center" }}>
          <AlertTriangle size={14} /> The AI brief could not be written. The raw facts are still used for the messages.
        </div>
      )}

      {errors.length ? (
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "#fffaeb", border: "1px solid #f6dfa4" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700, color: COLORS.warn }}>
            <AlertTriangle size={12} /> {errors.length} source{errors.length > 1 ? "s" : ""} unavailable
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: COLORS.ink2, lineHeight: 1.5 }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sources.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: COLORS.ink2 }}
          >
            {showSources ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {sources.length} source{sources.length > 1 ? "s" : ""} read
          </button>
          {showSources ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 12, color: "#0a66c2", textDecoration: "none", minWidth: 0 }}
                >
                  <ExternalLink size={10} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  {s.date ? <span style={{ color: COLORS.ink4, flexShrink: 0 }}>{s.date}</span> : null}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
