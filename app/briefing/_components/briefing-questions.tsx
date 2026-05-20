"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

export function BriefingQuestions({ questions }: { questions: string[] }) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  return (
    <Card padding={16}>
      <SectionHeader title="Questions à poser" />
      <ol
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {questions.map((q, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "10px 12px",
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              background: COLORS.bgSoft,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: COLORS.brand,
                fontVariantNumeric: "tabular-nums",
                minWidth: 18,
                marginTop: 1,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5 }}>{q}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
