"use client";

import * as React from "react";
import { Linkedin, ExternalLink, Sparkles, RefreshCw } from "lucide-react";
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
}

interface ApiResponse {
  profile?: LinkedinProfile;
  contact?: { name: string; email: string | null };
  error?: string;
}

export function DealLinkedinCard({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [hasFetched, setHasFetched] = React.useState(false);

  async function fetchProfile() {
    setLoading(true);
    setHasFetched(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/linkedin`);
      const json = (await r.json()) as ApiResponse;
      setData(json);
    } catch {
      setData({ error: "Erreur réseau" });
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch au mount (les coûts sont contrôlés : 1-2 crédits par deal ouvert)
  React.useEffect(() => {
    void fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  if (loading && !data) {
    return (
      <Card padding={16} style={{ border: "1px solid #1d4ed8", boxShadow: "0 0 0 3px #1d4ed81a" }}>
        <SectionHeader title="LinkedIn" right={<LinkedinTag />} />
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>Enrichissement en cours…</p>
      </Card>
    );
  }

  if (!data?.profile) {
    if (!hasFetched) return null;
    return (
      <Card padding={16}>
        <SectionHeader
          title="LinkedIn"
          right={
            <button
              type="button"
              onClick={fetchProfile}
              disabled={loading}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
                background: COLORS.bgCard,
                cursor: "pointer",
                color: COLORS.ink2,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <RefreshCw size={11} /> Réessayer
            </button>
          }
        />
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>
          {data?.error ?? "Aucun profil LinkedIn trouvé pour ce deal."}
        </p>
      </Card>
    );
  }

  const p = data.profile;

  return (
    <Card padding={16} style={{ border: "1px solid #1d4ed8", boxShadow: "0 0 0 3px #1d4ed81a" }}>
      <SectionHeader
        title="LinkedIn"
        right={
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
            }}
          >
            <Linkedin size={12} /> Voir le profil <ExternalLink size={10} />
          </a>
        }
      />

      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
          {p.name}
          {data.contact?.name && data.contact.name !== p.name && (
            <span style={{ fontSize: 11, color: COLORS.ink3, fontWeight: 400 }}> (HubSpot : {data.contact.name})</span>
          )}
        </p>
        <p style={{ fontSize: 12, color: "#1d4ed8", margin: 0 }}>{p.headline}</p>
        {p.location && <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>{p.location}</p>}
      </div>

      {p.positions && p.positions.length > 0 && (
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
    </Card>
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

// Suppress unused
const _S = Sparkles;
void _S;
