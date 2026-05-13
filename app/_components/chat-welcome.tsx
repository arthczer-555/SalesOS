"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { SuggestionChip } from "@/components/ui/suggestion-chip";
import { COLORS } from "@/lib/design/tokens";
import { ConnectorRow } from "./connector-row";

const SUGGESTIONS = [
  "Quels deals sont à risque cette semaine ?",
  "Relances en retard sur le secteur retail ?",
  "Retrouve le dernier mail de Doctolib",
  "Rédige un cold email pour un VP People secteur énergie",
  "Explique la méthode MEDDIC en 3 phrases",
  "Plan de stand-up pour mon équipe lundi",
];

export function ChatWelcome({ onPick }: { onPick: (text: string) => void }) {
  const { user } = useUser();
  const firstName = user?.firstName ?? user?.username ?? "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        textAlign: "center",
        height: "100%",
        padding: "24px 16px",
      }}
    >
      <Image
        src="/logo.png"
        alt="Coachello"
        width={56}
        height={56}
        quality={100}
        className="rounded-2xl"
      />
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: COLORS.ink0,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {firstName ? `Bonjour ${firstName}, comment puis-je aider ?` : "Comment puis-je aider ?"}
      </h1>
      <p style={{ fontSize: 13, color: COLORS.ink3, maxWidth: 460, margin: 0 }}>
        Pose une question — j&apos;ai accès à HubSpot, Gmail, Slack, Drive, LinkedIn et au web.
      </p>

      {/* Suggestion chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          marginTop: 6,
          maxWidth: 720,
        }}
      >
        {SUGGESTIONS.map((q) => (
          <SuggestionChip key={q} onClick={() => onPick(q)}>
            {q}
          </SuggestionChip>
        ))}
      </div>

      {/* Connector row */}
      <div style={{ marginTop: 8 }}>
        <ConnectorRow />
      </div>

      {/* Advice card (preserved from original UI) */}
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          marginTop: 8,
          padding: "10px 16px",
          borderRadius: 12,
          background: "#fff8f0",
          border: "1px solid #ffe4c4",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#c2410c",
            margin: 0,
            marginBottom: 4,
          }}
        >
          Conseil
        </p>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: "#78350f", margin: 0 }}>
          Pour de meilleurs résultats, indique où chercher (HubSpot, Drive, Gmail, Slack)
          et précise le besoin (stage, deal, contact, période).{" "}
          <Link href="/prompt" style={{ textDecoration: "underline" }}>
            Personnalise ton guide.
          </Link>
        </p>
      </div>
    </div>
  );
}
