"use client";

import * as React from "react";
import type { ProspectingOverview } from "@/lib/hooks/use-prospecting-overview";

export interface NewCampaignOptions {
  personaId?: string | null;
  sourceListId?: string | null;
  scopeCompanyId?: string | null;
  name?: string;
}

export interface ProspectingShellValue {
  openNewCampaign: (opts?: NewCampaignOptions) => void;
  overview: ProspectingOverview | null;
  refreshOverview: () => void;
}

export const ProspectingShellContext = React.createContext<ProspectingShellValue>({
  openNewCampaign: () => undefined,
  overview: null,
  refreshOverview: () => undefined,
});

export function useProspectingShell(): ProspectingShellValue {
  return React.useContext(ProspectingShellContext);
}
