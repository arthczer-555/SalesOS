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
import { MailDrafter, type DraftRecipient } from "./mail-drafter";
import { ApolloEnrichModal } from "../../_components/apollo-enrich-modal";

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

  // Polling actif tant qu'au moins un brief est en running côté DB OU
  // qu'on a un POST en vol côté client. Le tick appelle reload() pour
  // synchroniser le payload complet.
  const isAnyRunning =
    briefs.ae_analysis?.status === "running" ||
    briefs.news?.status === "running" ||
    isRefreshing.ae_analysis ||
    isRefreshing.news;

  useBriefsPolling(id, isAnyRunning, reload);

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
      <DetailHeader company={company} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 440px",
            gap: 16,
            maxWidth: 1500,
            margin: "0 auto",
            alignItems: "start",
          }}
          className="watch-detail-grid"
        >
          <main style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <CrossPageActions company={company} onEnrichApollo={() => setApolloOpen(true)} />
            <AeAnalysisCard
              companyId={company.id}
              notes={company.notes}
              brief={briefs.ae_analysis}
              dependencies={{ news: briefs.news }}
              onRefresh={() => refresh("ae_analysis")}
              isRefreshing={isRefreshing.ae_analysis}
              clientError={errorByKind.ae_analysis ?? null}
              onProspect={addRecipients}
            />
            <ContactsCard companyId={company.id} onProspect={addRecipients} />
            <NewsCard
              brief={briefs.news}
              onRefresh={() => refresh("news")}
              isRefreshing={isRefreshing.news}
              clientError={errorByKind.news ?? null}
            />
          </main>

          <aside
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignSelf: "start",
              position: "sticky",
              top: 0,
              minWidth: 0,
            }}
            className="watch-drafter-col"
          >
            <MailDrafter
              companyId={company.id}
              recipients={recipients}
              onRecipientsChange={setRecipients}
            />
          </aside>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .watch-detail-grid {
            grid-template-columns: 1fr !important;
          }
          .watch-detail-grid > aside.watch-drafter-col {
            position: static !important;
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
