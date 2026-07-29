"use client";

import * as React from "react";
import { RefreshCw, Layers, Sparkles, Loader2, X, UserPlus, Banknote, Shuffle, Users, Linkedin } from "lucide-react";
import { COLORS, RADIUS } from "@/lib/design/tokens";
import { PageHeader } from "@/components/ui/page-header";
import { TabBar } from "@/components/ui/tab-bar";
import { useSignals, type SignalAction } from "@/lib/hooks/use-signals";
import type { SignalRow } from "@/lib/signals/types";
import { SignalStack } from "./_components/signal-stack";
import { SignalActModal } from "./_components/signal-act-modal";
import { SignalStatus } from "./_components/signal-status";

/**
 * Le feed n'a plus qu'une seule origine (scan marché global), donc les anciens
 * onglets Watchlist/Discovery ne partitionnaient plus rien d'utile. On filtre
 * désormais par TYPE d'évènement, ce que l'API supportait déjà sans que l'UI
 * ne l'expose.
 */
type Filter = "all" | "nomination" | "funding" | "restructuring" | "hiring" | "linkedin_post";
type Banner = { kind: "ok" | "warn"; node: React.ReactNode; sticky?: boolean };

export default function SignalsPage() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [refreshing, setRefreshing] = React.useState(false);
  const [banner, setBanner] = React.useState<Banner | null>(null);
  const [actSignal, setActSignal] = React.useState<SignalRow | null>(null);

  const { signals, error, isLoading, mutate, act, refresh } = useSignals(
    filter === "all" ? {} : { type: filter },
  );

  // Référence vers la liste courante : sert de baseline au refresh sans recréer
  // les callbacks (sinon le polling capture des closures périmées).
  const signalsRef = React.useRef(signals);
  React.useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);

  // Résout l'attente d'un swipe "accept" : true si le signal a été traité dans la
  // pop-up, false si annulé (la carte revient alors dans la pile).
  const actResolve = React.useRef<((actioned: boolean) => void) | null>(null);

  // Timer de polling du refresh (nettoyé au démontage pour ne pas setState après).
  const pollRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    },
    [],
  );

  // Auto-dismiss des bannières non persistantes (erreur d'action, fin de scan).
  React.useEffect(() => {
    if (!banner || banner.sticky) return;
    const t = window.setTimeout(() => setBanner(null), 6_000);
    return () => window.clearTimeout(t);
  }, [banner]);

  const onAction = React.useCallback(
    async (signal: SignalRow, action: SignalAction): Promise<boolean> => {
      if (action === "accept") {
        // Ouvre la pop-up : choix du destinataire -> reveal Apollo -> brouillon.
        // On attend sa fermeture : annulée -> la carte revient (return false).
        setActSignal(signal);
        return new Promise<boolean>((resolve) => {
          actResolve.current = resolve;
        });
      }
      const res = await act(signal.id, action);
      mutate();
      if (!res.ok) {
        setBanner({
          kind: "warn",
          node: res.error
            ? `Could not update the signal: ${res.error}`
            : "Could not update the signal, it is back in your feed.",
        });
        return false;
      }
      return true;
    },
    [act, mutate],
  );

  const onRefresh = React.useCallback(async () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    setRefreshing(true);
    setBanner({ kind: "ok", sticky: true, node: "Scanning companies. This can take a few minutes, new signals appear here automatically." });

    // Le sweep tourne en arrière-plan et persiste tout son lot d'un coup à la fin
    // (pas au fil de l'eau). On mémorise les ids déjà affichés et on revalide
    // jusqu'à voir arriver le nouveau lot, puis on s'arrête. Spinner pendant
    // ~90 s, puis on continue à guetter en silence (le sweep dure parfois
    // plusieurs minutes) sans bloquer l'UI.
    const result = await refresh();
    if (!result.ok) {
      setRefreshing(false);
      setBanner({ kind: "warn", node: result.error ?? "Could not start the refresh. Try again in a moment." });
      return;
    }
    const baseline = new Set(signalsRef.current.map((s) => s.id));

    const SPINNER_MS = 90_000;
    const MAX_MS = 5 * 60_000;
    let elapsed = 0;

    const schedule = () => {
      const delay = elapsed < SPINNER_MS ? 6_000 : 15_000;
      pollRef.current = window.setTimeout(async () => {
        elapsed += delay;
        const fresh = await mutate();
        const incoming = (fresh?.signals ?? []).filter((s) => !baseline.has(s.id));
        if (incoming.length > 0) {
          setRefreshing(false);
          const n = incoming.length;
          setBanner({ kind: "ok", node: `Refresh complete. ${n} new signal${n > 1 ? "s" : ""} found.` });
          return;
        }
        if (elapsed >= SPINNER_MS) setRefreshing(false);
        if (elapsed >= MAX_MS) {
          setBanner({ kind: "warn", sticky: true, node: "Still scanning in the background. New signals will appear shortly, or reload the page." });
          return;
        }
        schedule();
      }, delay);
    };
    schedule();
  }, [refresh, mutate]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <PageHeader
        title="Signals"
        subtitle="Swipe right to act (draft + contact), left to dismiss."
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <SignalStatus />
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: RADIUS.md,
                border: `1px solid ${COLORS.line}`,
                background: COLORS.bgCard,
                color: COLORS.ink1,
                fontSize: 13,
                cursor: refreshing ? "default" : "pointer",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
        }
        tabs={
          <TabBar
            tabs={[
              { key: "all", label: "All", icon: Layers },
              { key: "nomination", label: "Leadership", icon: UserPlus },
              { key: "funding", label: "Funding", icon: Banknote },
              { key: "restructuring", label: "Transformation", icon: Shuffle },
              { key: "hiring", label: "Hiring", icon: Users },
              { key: "linkedin_post", label: "LinkedIn", icon: Linkedin },
            ]}
            active={filter}
            onChange={(k) => setFilter(k as Filter)}
          />
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 20px 80px" }}>
        {banner && (
          <div
            style={{
              maxWidth: 460,
              margin: "0 auto 20px",
              padding: "10px 14px",
              borderRadius: RADIUS.md,
              fontSize: 13,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              background: banner.kind === "ok" ? COLORS.okBg : COLORS.warnBg,
              color: banner.kind === "ok" ? COLORS.ok : COLORS.warn,
              border: `1px solid ${banner.kind === "ok" ? COLORS.ok : COLORS.warn}22`,
            }}
          >
            <div style={{ flex: 1 }}>{banner.node}</div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label="Dismiss"
              style={{ border: "none", background: "none", color: "inherit", cursor: "pointer", padding: 0, opacity: 0.7, flexShrink: 0 }}
            >
              <X size={15} />
            </button>
          </div>
        )}

        <div style={{ maxWidth: 460, margin: "0 auto 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.ink2 }}>
          <Sparkles size={13} style={{ color: COLORS.brand }} />
          Up to 10 market signals a day, each with someone to email. Acting adds the company to your watchlist.
        </div>

        {error ? (
          <div style={{ textAlign: "center", color: COLORS.err, fontSize: 13, padding: "40px 0" }}>{error}</div>
        ) : isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
          </div>
        ) : (
          <SignalStack key={filter} signals={signals} onAction={onAction} />
        )}
      </div>

      {actSignal && (
        <SignalActModal
          key={actSignal.id}
          signal={actSignal}
          onClose={(actioned) => {
            // Résout l'attente du swipe : actionné -> la carte reste partie ;
            // annulé -> elle revient dans la pile.
            actResolve.current?.(!!actioned);
            actResolve.current = null;
            setActSignal(null);
          }}
          onActioned={() => mutate()}
        />
      )}
    </div>
  );
}
