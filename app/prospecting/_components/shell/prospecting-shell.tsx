"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Crosshair, ListChecks, Megaphone, MessageCircleReply, Plus, Users, Zap } from "lucide-react";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { useProspectingOverview } from "@/lib/hooks/use-prospecting-overview";
import { readRepliesSeen, REPLIES_SEEN_EVENT } from "@/lib/hooks/use-prospecting-replies";
import { NewCampaignModal } from "../campaigns/new-campaign-modal";
import { MailboxHealthChip } from "./mailbox-health-chip";
import { ProspectingShellContext, type NewCampaignOptions } from "./shell-context";

const SECTIONS = [
  { key: "campaigns", href: "/prospecting/campaigns", label: "Campaigns", icon: Megaphone },
  { key: "quick", href: "/prospecting/quick", label: "Quick email", icon: Zap },
  { key: "prospects", href: "/prospecting/prospects", label: "Prospects", icon: Users },
  { key: "tasks", href: "/prospecting/tasks", label: "Tasks", icon: ListChecks },
  { key: "replies", href: "/prospecting/replies", label: "Replies", icon: MessageCircleReply },
  { key: "playbook", href: "/prospecting/playbook", label: "Playbook", icon: BookOpen },
] as const;

// Coquille de l'app Prospecting : une seule barre (marque, sections, santé de
// la boîte d'envoi, nouvelle campagne), bandeaux d'alerte, puis la section.
export function ProspectingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Dernière visite de Replies (localStorage) : le badge compte les réponses reçues depuis.
  const [repliesSince, setRepliesSince] = React.useState<string | null>(null);
  React.useEffect(() => {
    const sync = () => setRepliesSince(readRepliesSeen());
    sync();
    window.addEventListener(REPLIES_SEEN_EVENT, sync);
    return () => window.removeEventListener(REPLIES_SEEN_EVENT, sync);
  }, []);
  const { overview, mutate } = useProspectingOverview(repliesSince);
  const { toast } = useToast();
  const [newOpen, setNewOpen] = React.useState(false);
  const [newOptions, setNewOptions] = React.useState<NewCampaignOptions | null>(null);

  const active = SECTIONS.find((s) => pathname?.startsWith(s.href))?.key ?? "campaigns";

  const openNewCampaign = React.useCallback((opts?: NewCampaignOptions) => {
    setNewOptions(opts ?? null);
    setNewOpen(true);
  }, []);

  // Retour du flux OAuth "boîte d'envoi dédiée" : ?mailbox=connected|error|no_refresh_token
  React.useEffect(() => {
    const m = searchParams?.get("mailbox");
    if (!m) return;
    if (m === "connected") toast("Dedicated mailbox connected. Campaigns now send from it.", "success");
    else if (m === "no_refresh_token") toast("Google did not grant offline access. Remove CoachelloHQ from your Google account permissions and connect again.", "error");
    else toast("The mailbox could not be connected. Try again.", "error");
    void mutate();
    const url = new URL(window.location.href);
    url.searchParams.delete("mailbox");
    window.history.replaceState(null, "", url.toString());
  }, [searchParams, toast, mutate]);

  // Liens profonds depuis la Watch List / les listes : ?new=1&listId=...&scopeCompanyId=...
  React.useEffect(() => {
    if (searchParams?.get("new") !== "1") return;
    openNewCampaign({
      sourceListId: searchParams.get("listId"),
      scopeCompanyId: searchParams.get("scopeCompanyId"),
      personaId: searchParams.get("personaId"),
      name: searchParams.get("name") ?? undefined,
    });
    const url = new URL(window.location.href);
    ["new", "listId", "scopeCompanyId", "personaId", "name"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url.toString());
  }, [searchParams, openNewCampaign]);

  const tabs: TabItem[] = SECTIONS.map((s) => {
    const item: TabItem = { key: s.key, label: s.label, icon: s.icon };
    if (s.key === "tasks" && overview?.tasksDue) return { ...item, tone: "warn", count: overview.tasksDue };
    if (s.key === "replies" && overview?.repliesNew && active !== "replies") {
      return {
        ...item,
        badge: (
          <span
            title="New replies since your last visit"
            style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: COLORS.brand, borderRadius: 999, padding: "1px 6px", fontVariantNumeric: "tabular-nums" }}
          >
            {overview.repliesNew}
          </span>
        ),
      };
    }
    return item;
  });

  const health = overview?.health ?? null;
  const gmailMissing = health && !health.gmailConnected && !health.senderConnected;
  const disconnected = health?.mailbox?.status === "disconnected";

  const ctx = React.useMemo(
    () => ({ openNewCampaign, overview, refreshOverview: () => void mutate() }),
    [openNewCampaign, overview, mutate],
  );

  return (
    <ProspectingShellContext.Provider value={ctx}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
        <header
          style={{
            flexShrink: 0,
            background: "#fff",
            borderBottom: `1px solid ${COLORS.line}`,
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            minHeight: 56,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                background: `linear-gradient(135deg, ${COLORS.brand}, #ff6aa2)`,
                color: "#fff",
                boxShadow: "0 4px 12px rgba(240, 21, 99, 0.25)",
              }}
            >
              <Crosshair size={16} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: COLORS.ink0, letterSpacing: "-0.02em" }}>Prospecting</span>
          </div>
          <div style={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", alignItems: "flex-end" }}>
            <TabBar
              className="ch-tabs"
              style={{ marginTop: 0, borderBottom: 0 }}
              tabs={tabs}
              active={active}
              onChange={(k) => {
                const s = SECTIONS.find((x) => x.key === k);
                if (s) router.push(s.href);
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <MailboxHealthChip health={health} onChanged={() => void mutate()} />
            <Button variant="primary" icon={Plus} onClick={() => openNewCampaign()}>
              New campaign
            </Button>
          </div>
        </header>

        {gmailMissing || disconnected ? (
          <div style={{ padding: "12px 20px 0" }}>
            <Banner
              tone={disconnected ? "err" : "warn"}
              title={disconnected ? "Your sending mailbox is disconnected" : "Connect Gmail to send sequences"}
              action={
                <a className="ch-btn ch-btn-sm ch-btn-primary" href="/api/gmail/connect">
                  {disconnected ? "Reconnect" : "Connect Gmail"}
                </a>
              }
            >
              {disconnected
                ? "Google access expired or was revoked. Emails are on hold until you reconnect; nothing is lost."
                : "Emails are sent from your own Gmail and replies are detected there. You can still build campaigns and review messages meanwhile."}
            </Banner>
          </div>
        ) : null}

        <div className="thin-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
      <NewCampaignModal open={newOpen} onClose={() => setNewOpen(false)} options={newOptions} />
    </ProspectingShellContext.Provider>
  );
}
