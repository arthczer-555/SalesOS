"use client";

import { useState } from "react";
import { ExternalLink, Search, RefreshCw } from "lucide-react";
import { useSalesCoachRecaps, type SalesCoachRecapItem } from "@/lib/hooks/use-sales-coach";
import { COLORS } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";

type AudienceFilter = "all" | "prospect" | "client";

function formatDate(iso: string | null): string {
  if (!iso) return "?";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return "?";
  }
}

function AudienceTag({ audience }: { audience: "prospect" | "client" | null }) {
  if (!audience) return null;
  const isClient = audience === "client";
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: isClient ? "#ecfdf5" : "#eff6ff",
        color: isClient ? "#047857" : "#1e40af",
      }}
    >
      {isClient ? "Client" : "Prospect"}
    </span>
  );
}

function RecapItem({
  recap,
  selected,
  onSelect,
}: {
  recap: SalesCoachRecapItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const company = recap.company || recap.meeting_title || "?";
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 14px",
        background: selected ? COLORS.brandTint : "transparent",
        border: "none",
        borderBottom: `1px solid ${COLORS.line}`,
        cursor: "pointer",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <CompanyAvatar name={company} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {company}
          </span>
          <AudienceTag audience={recap.audience} />
        </div>
        <div style={{ fontSize: 11, color: COLORS.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {recap.meeting_title ?? "Meeting"}
        </div>
        <div style={{ fontSize: 10, color: COLORS.ink3, marginTop: 2 }}>
          {formatDate(recap.meeting_started_at)}
          {recap.meeting_recap_slack_sent_at ? " · Slack ✓" : " · Slack not sent"}
        </div>
      </div>
    </button>
  );
}

function RecapDetail({ recap }: { recap: SalesCoachRecapItem }) {
  const slackText = recap.meeting_recap_slack_text;
  const fallback = recap.meeting_recap;

  const recipients = recap.meeting_recap_slack_recipients;
  const recipientNames = recipients?.map((email) => email.split("@")[0]).join(", ");

  return (
    <div style={{ padding: "20px 28px", maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink0, margin: 0 }}>
          {recap.company || recap.meeting_title || "Meeting"}
        </h2>
        <AudienceTag audience={recap.audience} />
      </div>
      <div style={{ fontSize: 12, color: COLORS.ink2, marginBottom: recipients?.length ? 8 : 18 }}>
        {recap.meeting_title ?? ""} · {formatDate(recap.meeting_started_at)}
        {recap.meeting_recap_slack_permalink && (
          <>
            {" · "}
            <a
              href={recap.meeting_recap_slack_permalink}
              target="_blank"
              rel="noreferrer"
              style={{ color: COLORS.brand, display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              Open in Slack <ExternalLink size={11} />
            </a>
          </>
        )}
      </div>
      {recipients && recipients.length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 18 }}>
          Sent to: <span style={{ color: COLORS.ink1, fontWeight: 500 }}>{recipientNames}</span>
        </div>
      )}
      {recap.meeting_recap_slack_sent_at && (!recipients || recipients.length === 0) && (
        <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 18 }}>
          Sent (recipients not tracked)
        </div>
      )}

      {slackText ? (
        <pre
          style={{
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            lineHeight: 1.55,
            color: COLORS.ink1,
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
          }}
        >
          {slackText}
        </pre>
      ) : fallback ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {(["context", "need", "risks_competition", "opportunities", "next_steps"] as const).map((key) => {
            const value = fallback[key]?.trim();
            if (!value) return null;
            const label = {
              context: "Context",
              need: "Need",
              risks_competition: recap.audience === "client" ? "Risks" : "Risks / Competition",
              opportunities: "Opportunities",
              next_steps: "Next steps",
            }[key];
            return (
              <div key={key}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.ink3, marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                  {value}
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: COLORS.ink3, fontStyle: "italic", marginTop: 8 }}>
            Slack message not captured (recap predates the update). Re-rendered from the JSON.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: COLORS.ink3 }}>No recap content.</div>
      )}
    </div>
  );
}

export function RecapsView() {
  const [audience, setAudience] = useState<AudienceFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { recaps, isLoading, error, reload } = useSalesCoachRecaps(audience);

  const filtered = search
    ? recaps.filter((r) => {
        const hay = [
          r.company,
          r.meeting_title,
          r.primary_contact?.name,
          r.primary_contact?.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search.toLowerCase());
      })
    : recaps;

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="flex h-full" style={{ background: COLORS.bgPage }}>
      <div className="w-[300px] flex-shrink-0 flex flex-col" style={{ borderRight: `1px solid ${COLORS.line}` }}>
        <div
          style={{
            padding: "14px 14px 12px",
            background: COLORS.bgCard,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
              {filtered.length} recap{filtered.length > 1 ? "s" : ""}
            </div>
            <button
              onClick={() => reload()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 7px",
                borderRadius: 6,
                color: COLORS.brand,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={11} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {(["all", "prospect", "client"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setAudience(opt)}
                style={{
                  flex: 1,
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "5px 6px",
                  borderRadius: 6,
                  border: `1px solid ${audience === opt ? COLORS.brand : COLORS.line}`,
                  background: audience === opt ? COLORS.brandTint : "transparent",
                  color: audience === opt ? COLORS.brand : COLORS.ink2,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {opt === "all" ? "All" : opt === "prospect" ? "Prospects" : "Clients"}
              </button>
            ))}
          </div>

          <div style={{ position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                width: "100%",
                padding: "6px 8px 6px 26px",
                fontSize: 12,
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
                background: "#fff",
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: COLORS.ink3 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: COLORS.err }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: COLORS.ink3 }}>
              No recaps.
            </div>
          ) : (
            filtered.map((r) => (
              <RecapItem
                key={r.id}
                recap={r}
                selected={r.id === (selected?.id ?? null)}
                onSelect={() => setSelectedId(r.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? (
          <RecapDetail recap={selected} />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ fontSize: 13, color: COLORS.ink3 }}
          >
            Select a recap to view the Slack message.
          </div>
        )}
      </div>
    </div>
  );
}
