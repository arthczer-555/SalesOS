"use client";

import * as React from "react";
import { Linkedin, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

interface LinkedinProfile {
  username: string;
  name: string;
  headline: string;
  summary: string;
  location?: string;
  positions: { company: string; title: string; start: string | null; end: string }[];
  skills: string[];
  education: string[];
  profileUrl: string;
  contactName: string;
  contactEmail: string | null;
}

interface ApiResponse {
  profiles?: LinkedinProfile[];
  error?: string;
}

export function DealLinkedinCard({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function fetchProfiles() {
      setLoading(true);
      try {
        const r = await fetch(`/api/deals/${dealId}/linkedin`);
        const json = (await r.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ profiles: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchProfiles();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading && !data) {
    return (
      <Card padding={16} style={{ border: "1px solid #1d4ed8", boxShadow: "0 0 0 3px #1d4ed81a" }}>
        <SectionHeader title="LinkedIn" right={<LinkedinTag />} />
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>Enrichissement en cours…</p>
      </Card>
    );
  }

  const profiles = data?.profiles ?? [];
  if (profiles.length === 0) return null;

  return (
    <Card padding={16} style={{ border: "1px solid #1d4ed8", boxShadow: "0 0 0 3px #1d4ed81a" }}>
      <SectionHeader title={`LinkedIn (${profiles.length})`} right={<LinkedinTag />} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {profiles.map((p, idx) => (
          <ProfileBlock key={p.username} profile={p} divider={idx < profiles.length - 1} />
        ))}
      </div>
    </Card>
  );
}

function ProfileBlock({ profile, divider }: { profile: LinkedinProfile; divider: boolean }) {
  const p = profile;
  return (
    <div style={{ paddingBottom: divider ? 14 : 0, borderBottom: divider ? `1px solid ${COLORS.line}` : "none" }}>
      <div style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
            {p.name}
            {p.contactName && p.contactName !== p.name && (
              <span style={{ fontSize: 11, color: COLORS.ink3, fontWeight: 400 }}> (HubSpot : {p.contactName})</span>
            )}
          </p>
          <p style={{ fontSize: 12, color: "#1d4ed8", margin: 0 }}>{p.headline}</p>
          {p.location && <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>{p.location}</p>}
        </div>
        <a
          href={p.profileUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "#0a66c2",
            fontSize: 11,
            fontWeight: 600,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <Linkedin size={12} /> Voir <ExternalLink size={10} />
        </a>
      </div>

      {p.positions.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={uppercaseLabel()}>Parcours</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {p.positions.map((pos, i) => (
              <div key={i} style={{ fontSize: 12, color: COLORS.ink1, lineHeight: 1.4 }}>
                <strong style={{ color: COLORS.ink0 }}>{pos.title}</strong> @ {pos.company}{" "}
                <span style={{ color: COLORS.ink3 }}>
                  ({pos.start ?? "?"} → {pos.end})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {p.skills.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={uppercaseLabel()}>Compétences</p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {p.skills.slice(0, 12).map((s) => (
              <span
                key={s}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: COLORS.bgSoft,
                  color: COLORS.ink2,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {p.education.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={uppercaseLabel()}>Formation</p>
          <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0 }}>{p.education.join(" · ")}</p>
        </div>
      )}

      {p.summary && (
        <div>
          <p style={uppercaseLabel()}>Bio</p>
          <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, lineHeight: 1.5 }}>{p.summary}</p>
        </div>
      )}
    </div>
  );
}

function LinkedinTag() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#1d4ed8" }}>
      <Linkedin size={11} />
      <span style={{ fontSize: 10, fontWeight: 600 }}>LinkedIn</span>
    </span>
  );
}

function uppercaseLabel(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: COLORS.ink3,
    margin: 0,
    marginBottom: 4,
  };
}
