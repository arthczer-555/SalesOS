"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Linkedin, CheckCircle2 } from "lucide-react";
import { COLORS, SHADOWS, companyAvatarGradient } from "@/lib/design/tokens";
import type { OrgPerson } from "@/lib/orgchart/types";
import {
  LEVEL_LABELS,
  DECISION_ROLE_LABELS,
  levelBadge,
  decisionRoleBadge,
  relationshipBadge,
  RELATIONSHIP_LABELS,
  initials,
  displayName,
} from "../_helpers";

// Handles invisibles : les arêtes s'y rattachent toujours, mais on ne veut pas
// des petits points gris sous chaque carte (confus). Non connectables (le
// re-parentage se fait par drag-and-drop d'une carte sur une autre).
const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: "none",
  background: "transparent",
  pointerEvents: "none",
};

export type ContactNodeData = { person: OrgPerson; dimmed?: boolean };
export type ContactNodeType = Node<ContactNodeData, "contact">;

function Badge({ fg, bg, children }: { fg: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 999,
        color: fg,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function ContactNodeImpl({ data, selected }: NodeProps<ContactNodeType>) {
  const p = data.person;
  const name = displayName(p.name);
  const grad = companyAvatarGradient(name);
  const title = p.title || p.title_hubspot || "No title yet";
  const hasTitle = !!(p.title || p.title_hubspot);
  const lvl = levelBadge(p.level);
  const role = decisionRoleBadge(p.decision_role);
  const rel = relationshipBadge(p.relationship_status);

  return (
    <div
      style={{
        width: 250,
        minHeight: 88,
        background: COLORS.bgCard,
        border: `1.5px solid ${selected ? COLORS.brand : COLORS.lineStrong}`,
        borderRadius: 12,
        boxShadow: selected ? SHADOWS.pop : SHADOWS.card,
        padding: 11,
        opacity: data.dimmed ? 0.45 : 1,
        transition: "box-shadow .15s, border-color .15s, opacity .15s",
        cursor: "grab",
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} isConnectable={false} />
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            ...grad,
          }}
        >
          {initials(name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 4,
              fontSize: 13,
              fontWeight: 700,
              color: COLORS.ink0,
              lineHeight: 1.2,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              title={name}
            >
              {name}
            </span>
            {p.in_hubspot && <CheckCircle2 size={13} style={{ color: COLORS.ok, flexShrink: 0, marginTop: 1 }} />}
            {p.linkedin_url && (
              <a
                href={p.linkedin_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="nodrag"
                style={{ color: "#0a66c2", display: "inline-flex", flexShrink: 0, marginTop: 1 }}
                title="LinkedIn"
              >
                <Linkedin size={12} />
              </a>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              fontStyle: hasTitle ? "normal" : "italic",
              color: hasTitle ? COLORS.ink2 : COLORS.ink4,
              lineHeight: 1.25,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
            title={title}
          >
            {title}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {p.level && p.level !== "unknown" && (
          <Badge fg={lvl.fg} bg={lvl.bg}>
            {LEVEL_LABELS[p.level]}
          </Badge>
        )}
        {p.decision_role && p.decision_role !== "unknown" && (
          <Badge fg={role.fg} bg={role.bg}>
            {DECISION_ROLE_LABELS[p.decision_role]}
          </Badge>
        )}
        {p.relationship_status && p.relationship_status !== "unknown" && (
          <Badge fg={rel.fg} bg={rel.bg}>
            {RELATIONSHIP_LABELS[p.relationship_status]}
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}

export const ContactNode = memo(ContactNodeImpl);
