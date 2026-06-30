"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { COLORS } from "@/lib/design/tokens";
import {
  useWatchCompanyDetail,
  useBriefRefresh,
  useBriefsPolling,
} from "@/lib/hooks/use-watchlist-company";
import { DetailHeader } from "./detail-header";
import { CrossPageActions } from "./cross-page-actions";
import { AeAnalysisCard } from "./ae-analysis-card";
import { ContactsCard } from "./contacts-card";
import { NewsCard } from "./news-card";
import { SignalsCard } from "./signals-card";
import { EmailHistoryCard } from "./email-history-card";
import { MailDrafter, type DraftRecipient, type DraftPrefill } from "./mail-drafter";
import { ApolloEnrichModal } from "../../_components/apollo-enrich-modal";
import type { AeTarget } from "@/lib/watchlist/briefs";

export function WatchCompanyPage({ id }: { id: string }) {
  const {
    company,
    briefs,
    isLoading,
    error,
    reload,
  } = useWatchCompanyDetail(id);
  const router = useRouter();

  // Refresh hook (POST sur la route /briefs/{kind}). onComplete relance
  // le payload détaillé pour récupérer la dernière brief (cas inline) ou
  // déclencher le polling (cas BG fn).
  const { refresh, isRefreshing, errorByKind } = useBriefRefresh(id, reload);
  const { mutate } = useSWRConfig();
  const [apolloOpen, setApolloOpen] = React.useState(false);

  // Token incrémenté à chaque génération : réarme le minuteur anti-blocage du
  // polling (sinon un regénérer après un timeout ne relancerait pas le poll).
  const [runToken, setRunToken] = React.useState(0);
  const startRun = React.useCallback(
    (kind: "ae_analysis" | "news", options?: { withMessages?: boolean; targets?: AeTarget[] }) => {
      setRunToken((t) => t + 1);
      refresh(kind, options);
    },
    [refresh],
  );

  // Polling actif tant qu'au moins un brief est en running côté DB OU
  // qu'on a un POST en vol côté client. Le tick appelle reload() pour
  // synchroniser le payload complet.
  const isAnyRunning =
    briefs.ae_analysis?.status === "running" ||
    briefs.news?.status === "running" ||
    isRefreshing.ae_analysis ||
    isRefreshing.news;

  const { stalled } = useBriefsPolling(id, isAnyRunning, reload, runToken);

  // Destinataires du drafteur de mail (panneau droit). Alimenté depuis la
  // contacts card et l'analyse AE. Dédup par email.
  const [recipients, setRecipients] = React.useState<DraftRecipient[]>([]);
  const addRecipients = React.useCallback((incoming: DraftRecipient[]) => {
    setRecipients((prev) => {
      const next = [...prev];
      for (const r of incoming) {
        if (!r.email) continue;
        if (next.some((x) => x.email.toLowerCase() === r.email.toLowerCase())) continue;
        next.push(r);
      }
      return next;
    });
  }, []);

  // Prospect depuis l'analyse AE / les signaux : le(s) prospect(s) vont dans la
  // liste des destinataires (BCC en envoi groupé, un mail chacun en personnalisé),
  // comme la contacts card. L'objet + opening message proposés préremplissent le
  // mail si vide. Avant, le contact passait en To, ce qui le rendait invisible en
  // mode personnalisé (canSend restait faux).
  const [prefill, setPrefill] = React.useState<DraftPrefill | null>(null);
  const prospectFromAnalysis = React.useCallback(
    (incoming: DraftRecipient[], seed?: { subject: string | null; body: string | null }) => {
      const valid = incoming.filter((r) => r.email);
      if (valid.length === 0) return;
      addRecipients(valid);
      setPrefill({
        nonce: Date.now(),
        subject: seed?.subject ?? null,
        body: seed?.body ?? null,
      });
    },
    [addRecipients],
  );

  React.useEffect(() => {
    router.prefetch("/watchlist");
  }, [router]);

  if (isLoading && !company) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: COLORS.bgPage,
        }}
      >
        <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: COLORS.bgPage,
          gap: 12,
        }}
      >
        <p style={{ color: COLORS.ink2, fontSize: 13 }}>
          {error ?? "Account not found."}
        </p>
        <Link
          href="/watchlist"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            color: COLORS.ink1,
            textDecoration: "none",
            fontSize: 12,
            background: COLORS.bgCard,
          }}
        >
          <ArrowLeft size={13} /> Back to Watch List
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bgPage,
        overflow: "hidden",
      }}
    >
      <DetailHeader company={company} onEnrich={() => setApolloOpen(true)} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 3fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
          className="watch-detail-grid"
        >
          {/* Colonne gauche : actions + contacts HubSpot + historique mails. */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <CrossPageActions company={company} onEnrichApollo={() => setApolloOpen(true)} />
            <ContactsCard companyId={company.id} onProspect={addRecipients} />
            <EmailHistoryCard companyId={company.id} />
          </aside>

          {/* Colonne centrale (60%) : analyse AE + news. */}
          <main style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {stalled && (
              <div
                style={{
                  fontSize: 12,
                  padding: "9px 12px",
                  borderRadius: 8,
                  background: COLORS.warnBg,
                  color: COLORS.warn,
                  border: `1px solid ${COLORS.warn}22`,
                }}
              >
                Generation is taking longer than expected and may have failed. Try regenerating below.
              </div>
            )}
            <AeAnalysisCard
              companyId={company.id}
              notes={company.notes}
              brief={briefs.ae_analysis}
              dependencies={{ news: briefs.news }}
              onGenerate={(withMessages, targets) => startRun("ae_analysis", { withMessages, targets })}
              isRefreshing={isRefreshing.ae_analysis}
              clientError={errorByKind.ae_analysis ?? null}
              onProspect={prospectFromAnalysis}
              onSent={() => mutate(`/api/watchlist/companies/${company.id}/emails`)}
            />
            <NewsCard
              brief={briefs.news}
              onRefresh={() => startRun("news")}
              isRefreshing={isRefreshing.news}
              clientError={errorByKind.news ?? null}
            />
            <SignalsCard companyId={company.id} onProspect={prospectFromAnalysis} />
          </main>

          {/* Colonne droite : le drafteur de mail. Pas de sticky : elle défile
              avec la page, en même temps que les autres colonnes. */}
          <aside
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignSelf: "start",
              minWidth: 0,
            }}
            className="watch-drafter-col"
          >
            <MailDrafter
              companyId={company.id}
              recipients={recipients}
              onRecipientsChange={setRecipients}
              onSent={() => mutate(`/api/watchlist/companies/${company.id}/emails`)}
              prefill={prefill}
            />
          </aside>
        </div>
      </div>

      <style>{`
        @media (max-width: 1400px) {
          .watch-detail-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (max-width: 1000px) {
          .watch-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      {apolloOpen && (
        <ApolloEnrichModal
          prefill={{
            hubspotCompanyId: company.hubspot_company_id,
            companyName: company.name,
            scopeCompanyId: company.id,
          }}
          onClose={() => setApolloOpen(false)}
          onDone={() => {
            reload();
            mutate(`/api/watchlist/companies/${company.id}/contacts`);
          }}
        />
      )}
    </div>
  );
}
