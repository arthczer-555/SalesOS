"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function GmailConnect({ initialConnected }: { initialConnected: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);
  const [noRefreshToken, setNoRefreshToken] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const param = searchParams.get("gmail");
    if (param === "connected") {
      setConnected(true);
      router.replace("/settings");
    } else if (param === "no_refresh_token") {
      setNoRefreshToken(true);
      router.replace("/settings");
    }
  }, [searchParams, router]);

  const connect = () => {
    setLoading(true);
    router.push("/api/gmail/connect");
  };

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
          style={{ background: "#f0fdf4", color: "#16a34a" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Connected
        </span>
        <button onClick={connect} className="text-xs" style={{ color: "#aaa" }}>
          Reconnect
        </button>
      </div>
    );
  }

  if (noRefreshToken) {
    return (
      <div className="space-y-2 text-right">
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
          Reconnection required
        </span>
        <p className="text-[10px]" style={{ color: "#888" }}>
          Google did not return a refresh token. Go to{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: "#f01563" }}>
            myaccount.google.com/permissions
          </a>
          , revoke CoachelloHQ access, then reconnect.
        </p>
        <button
          onClick={connect}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg font-medium"
          style={{ background: "#f01563", color: "#fff", opacity: loading ? 0.7 : 1 }}
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl text-white transition-all active:scale-95"
      style={{ background: "#f01563", opacity: loading ? 0.7 : 1 }}
    >
      {loading ? (
        <>
          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          Redirecting…
        </>
      ) : (
        "Connect Gmail"
      )}
    </button>
  );
}
