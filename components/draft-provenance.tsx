"use client";

import * as React from "react";
import { Linkedin, FileText, Database, Info } from "lucide-react";
import type { DraftProvenance } from "@/lib/prospection/provenance";

/**
 * Petit encart de transparence affiché sous un brouillon de prospection :
 * - accès LinkedIn (profil prospect / fiche entreprise)
 * - articles web dont le message a pu s'inspirer (cliquables)
 * - autres contextes injectés dans le prompt (CRM, guide, email précédent…)
 *
 * Rendu neutre (thème clair) pour s'intégrer aux pages prospecting & mass-prospection.
 * Ne rend rien si aucune provenance n'est disponible.
 */
export function DraftProvenanceCard({ provenance }: { provenance?: DraftProvenance | null }) {
  if (!provenance) return null;
  const { linkedinProfile, companyLinkedin, webSources, contexts } = provenance;
  const hasLinkedin = linkedinProfile || companyLinkedin;
  const linkedinLabel =
    linkedinProfile && companyLinkedin
      ? "LinkedIn profile + company"
      : linkedinProfile
        ? "LinkedIn profile"
        : companyLinkedin
          ? "Company LinkedIn"
          : "No LinkedIn access";

  return (
    <div style={{ border: "1px solid #eee", background: "#fafafa", borderRadius: 10, padding: "10px 12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 8,
          color: "#999",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontSize: 9.5,
        }}
      >
        <Info size={11} /> How this draft was written
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Badge on={hasLinkedin} icon={<Linkedin size={11} />} label={linkedinLabel} color="#0a66c2" />
        {contexts.map((c) => (
          <Badge key={c} on icon={<Database size={11} />} label={c} color="#555" />
        ))}
      </div>

      {webSources.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: "#999", fontWeight: 600, marginBottom: 5, fontSize: 10 }}>
            Articles it can draw from
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {webSources.map((s, i) => (
              <a
                key={`${s.url}-${i}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.title}
                style={{
                  display: "flex",
                  gap: 5,
                  alignItems: "baseline",
                  color: "#0a66c2",
                  textDecoration: "none",
                  fontSize: 11,
                }}
              >
                <FileText size={10} style={{ flexShrink: 0, position: "relative", top: 1 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                {s.date && (
                  <span style={{ color: "#aaa", flexShrink: 0, fontSize: 10 }}>· {s.date}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({
  on,
  icon,
  label,
  color,
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        background: on ? "#fff" : "#f3f3f3",
        color: on ? color : "#bbb",
        border: `1px solid ${on ? "#e5e5e5" : "#eee"}`,
      }}
    >
      <span style={{ display: "inline-flex", opacity: on ? 1 : 0.5 }}>{icon}</span>
      {label}
    </span>
  );
}
