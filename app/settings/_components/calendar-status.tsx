"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function CalendarStatus({ gmailConnected }: { gmailConnected: boolean }) {
  const [status, setStatus] = useState<"loading" | "connected" | "scope_missing" | "not_connected" | "error">(
    gmailConnected ? "loading" : "not_connected"
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // After a Gmail reconnect, re-check calendar status
    if (searchParams.get("gmail") === "connected") {
      setStatus("loading");
    }
    if (!gmailConnected) {
      setStatus("not_connected");
      return;
    }
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) setStatus("connected");
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

  if (status === "scope_missing") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
          Permission manquante
        </span>
        <button
          onClick={() => router.push("/api/gmail/connect")}
          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
          style={{ background: "#f01563", color: "#fff" }}
        >
          Reconnecter →
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>
      {status === "not_connected" ? "Gmail non connecté" : "Non connecté"}
    </span>
  );
}
