"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function GmailConnect({ initialConnected }: { initialConnected: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);

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
    <button
      onClick={() => router.push("/api/gmail/connect")}
      className="text-sm px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
      style={{ background: "#f01563" }}
    >
      Connecter Gmail
    </button>
  );
}
