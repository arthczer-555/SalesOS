"use client";

import * as React from "react";
import useSWR from "swr";
import { Building2, Settings } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

interface RadarCompaniesResponse {
  data?: { id: string; username: string; is_active: boolean }[];
}

interface TargetsResponse {
  companies?: string[];
  roles?: string[];
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  const data = (await r.json().catch(() => null)) as T | { error?: string } | null;
  if (!r.ok) {
    const err = (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) || `HTTP ${r.status}`;
    throw new Error(err as string);
  }
  return (data ?? ({} as T)) as T;
};

interface TrackedCompaniesReadonlyProps {
  /** `radar` → Netrows Radar companies ; `icp` → ICP globales (guide_defaults). */
  source: "radar" | "icp";
  helpText: string;
  onOpenGlobalSettings: () => void;
}

export function TrackedCompaniesReadonly({ source, helpText, onOpenGlobalSettings }: TrackedCompaniesReadonlyProps) {
  const url = source === "radar" ? "/api/linkedin/setup-radar" : "/api/intel/admin/targets";
  const { data, error, isLoading } = useSWR<RadarCompaniesResponse | TargetsResponse>(url, (u: string) => fetcher(u), {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const companies: string[] = React.useMemo(() => {
    if (!data) return [];
    if (source === "radar") {
      return ((data as RadarCompaniesResponse).data ?? [])
        .filter((c) => c.is_active !== false)
        .map((c) => c.username)
        .filter(Boolean);
    }
    return (data as TargetsResponse).companies ?? [];
  }, [data, source]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>{helpText}</p>

      <div
        style={{
          padding: 10,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 8,
          background: COLORS.bgCard,
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {isLoading ? (
          <p style={msg()}>Chargement…</p>
        ) : error ? (
          <p style={{ ...msg(), color: COLORS.err }}>
            {error instanceof Error ? error.message : "Erreur de chargement."}
          </p>
        ) : companies.length === 0 ? (
          <p style={msg()}>Aucune entreprise suivie.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {companies.map((c) => (
              <span
                key={c}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 99,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgSoft,
                  color: COLORS.ink1,
                }}
              >
                <Building2 size={11} color={COLORS.ink3} />
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: COLORS.ink3 }}>
          {companies.length > 0 && `${companies.length} entreprise${companies.length > 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          onClick={onOpenGlobalSettings}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink1,
            cursor: "pointer",
          }}
        >
          <Settings size={11} />
          Gérer dans Cibles globales
        </button>
      </div>
    </div>
  );
}

function msg(): React.CSSProperties {
  return {
    margin: 0,
    fontSize: 12,
    color: COLORS.ink3,
    textAlign: "center" as const,
    padding: "10px 0",
  };
}
