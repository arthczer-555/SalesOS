"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function GmailConnect({ initialConnected }: { initialConnected: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      setConnected(true);
      router.replace("/settings");
    }
  }, [searchParams, router]);

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
          style={{ background: "#f0fdf4", color: "#16a34a" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Connecté
        </span>
        <button
          onClick={() => router.push("/api/gmail/connect")}
          className="text-xs"
          style={{ color: "#aaa" }}
        >
          Reconnecter
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!showTutorial ? (
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/api/gmail/connect")}
            className="text-sm px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
            style={{ background: "#f01563" }}
          >
            Connecter Gmail
          </button>
          <button
            onClick={() => setShowTutorial(true)}
            className="text-sm px-4 py-2 rounded-xl border transition-colors"
            style={{ borderColor: "#e5e5e5", color: "#888" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#111";
              e.currentTarget.style.borderColor = "#999";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#888";
              e.currentTarget.style.borderColor = "#e5e5e5";
            }}
          >
            Comment faire ?
          </button>
        </div>
      ) : (
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ borderColor: "#eeeeee" }}
        >
          <p className="text-sm font-medium" style={{ color: "#111" }}>
            Comment connecter ton Gmail
          </p>
          {[
            "Clique sur «\u00a0Connecter Gmail\u00a0» ci-dessous",
            "Une fenêtre Google s'ouvre — sélectionne ton compte @coachello.io",
            "Accepte les permissions (lecture des emails)",
            "Tu es redirigé automatiquement ici — c'est tout !",
          ].map((step, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span
                className="w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "#fde8ef", color: "#f01563" }}
              >
                {i + 1}
              </span>
              <p className="text-sm" style={{ color: "#555" }}>
                {step}
              </p>
            </div>
          ))}
          <button
            onClick={() => router.push("/api/gmail/connect")}
            className="mt-2 text-sm px-4 py-2 rounded-xl text-white w-full transition-opacity hover:opacity-90"
            style={{ background: "#f01563" }}
          >
            Connecter Gmail →
          </button>
        </div>
      )}
    </div>
  );
}
