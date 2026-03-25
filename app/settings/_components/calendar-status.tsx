"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Status = "loading" | "connected" | "scope_missing" | "api_not_enabled" | "not_connected" | "error";

export function CalendarStatus({ gmailConnected }: { gmailConnected: boolean }) {
  const [status, setStatus] = useState<Status>(gmailConnected ? "loading" : "not_connected");
  const [detail, setDetail] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!gmailConnected) { setStatus("not_connected"); return; }
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then((data) => {
        setDetail(data.detail ?? "");
        if (data.connected) setStatus("connected");
        else if (data.reason === "api_not_enabled") setStatus("api_not_enabled");
        else if (data.reason === "scope_missing") setStatus("scope_missing");
        else if (data.reason === "not_connected") setStatus("not_connected");
        else setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, [gmailConnected, searchParams]);

  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>
        Vérification…
      </span>
    );
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#f0fdf4", color: "#16a34a" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Connecté
        </span>
        <button onClick={() => router.push("/api/gmail/connect")} className="text-xs" style={{ color: "#aaa" }}>
          Reconnecter
        </button>
      </div>
    );
  }

  if (status === "api_not_enabled") {
    return (
      <div className="text-right space-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#fee2e2", color: "#991b1b" }}>
          API non activée
        </span>
        <p className="text-[10px]" style={{ color: "#888" }}>
          Active l&apos;API Google Calendar dans ta{" "}
          <a
            href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#f01563" }}
          >
            Google Cloud Console →
          </a>
        </p>
        {detail && <p className="text-[10px] font-mono" style={{ color: "#bbb" }}>{detail.slice(0, 80)}</p>}
      </div>
    );
  }

  if (status === "scope_missing") {
    return (
      <div className="text-right space-y-1.5">
        <div className="flex items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
            Permission manquante
          </span>
          <button
            onClick={() => router.push("/api/gmail/connect")}
            className="text-xs px-2.5 py-1 rounded-lg font-medium"
            style={{ background: "#f01563", color: "#fff" }}
          >
            Reconnecter →
          </button>
        </div>
        <p className="text-[10px]" style={{ color: "#888" }}>
          Si ça persiste, révoque d&apos;abord l&apos;accès sur{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: "#f01563" }}>
            myaccount.google.com/permissions
          </a>
          {" "}puis reconnecte.
        </p>
        {detail && <p className="text-[10px] font-mono" style={{ color: "#bbb" }}>{detail.slice(0, 80)}</p>}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>
      {status === "not_connected" ? "Gmail non connecté" : "Non connecté"}
    </span>
  );
}
