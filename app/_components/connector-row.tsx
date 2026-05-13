"use client";

import * as React from "react";
import { Globe, Mail, MessageSquare, Database, FolderOpen, Linkedin } from "lucide-react";
import { ConnectorChip } from "@/components/ui/connector-chip";

export function ConnectorRow({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 18,
        flexWrap: "wrap",
        justifyContent: "center",
        ...style,
      }}
    >
      <ConnectorChip icon={Globe} label="Web" />
      <ConnectorChip icon={Mail} label="Gmail" />
      <ConnectorChip icon={MessageSquare} label="Slack" />
      <ConnectorChip icon={Database} label="HubSpot" />
      <ConnectorChip icon={FolderOpen} label="Drive" />
      <ConnectorChip icon={Linkedin} label="LinkedIn" />
    </div>
  );
}
