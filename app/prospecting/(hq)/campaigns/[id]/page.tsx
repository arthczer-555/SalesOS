"use client";

import { use } from "react";
import { CampaignDetail } from "../../../_components/campaign/campaign-detail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampaignDetail key={id} id={id} />;
}
