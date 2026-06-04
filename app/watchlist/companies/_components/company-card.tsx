"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { COLORS, RADIUS, SHADOWS, repAccent } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import type { ScopeCompany } from "./types";

export function CompanyCard({
  company,
  mode = "select",
  selected = false,
  dimmed = false,
  selectable = false,
  selectionActive = false,
  onSelect,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  company: ScopeCompany;
  mode?: "select" | "read";
  selected?: boolean;
  dimmed?: boolean;
  /** Mode lecture : autorise la case à cocher de sélection multiple. */
  selectable?: boolean;
  /** Mode lecture : au moins une carte est sélectionnée (force l'affichage des cases). */
  selectionActive?: boolean;
  onSelect?: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent, company: ScopeCompany) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onRemove?: (company: ScopeCompany) => void;
}) {
  const router = useRouter();
  const [hover, setHover] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const owner = company.owner?.trim() || null;
  const accent = owner ? repAccent(owner) : null;
  const sub = [company.sector, company.current_coaching_platform].filter(Boolean).join(" · ");
  const isRead = mode === "read";

  React.useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function handleClick(e: React.MouseEvent) {
    if (isRead) {
      router.push(`/watchlist/${company.id}`);
    } else {
      onSelect?.(company.id, e);
    }
  }

  return (
    <div
      draggable={!isRead}
      role="button"
      tabIndex={0}
      aria-pressed={!isRead ? selected : undefined}
      onDragStart={!isRead ? (e) => onDragStart?.(e, company) : undefined}
      onDragEnd={!isRead ? onDragEnd : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isRead) router.push(`/watchlist/${company.id}`);
          else onSelect?.(company.id, e);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: selected ? COLORS.brandTintSoft : COLORS.bgCard,
        border: `1px solid ${selected ? COLORS.brand : hover ? COLORS.brandTint : COLORS.line}`,
        borderRadius: RADIUS.lg,
        padding: "10px 12px",
        cursor: isRead ? "pointer" : "grab",
        userSelect: "none",
        opacity: dimmed ? 0.4 : 1,
        boxShadow: hover && !selected ? SHADOWS.md : "none",
        transform: hover && !dimmed ? "translateY(-1px)" : "none",
        transition: "box-shadow .12s, transform .12s, border-color .12s, background .12s",
      }}
    >
      {/* case à cocher de sélection multiple (read) */}
      {isRead && selectable && (hover || selected || selectionActive) && (
        <button
          type="button"
          aria-pressed={selected}
          title={selected ? "Désélectionner" : "Sélectionner"}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToggleSelect?.(company.id, e);
          }}
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 18,
            height: 18,
            borderRadius: 5,
            border: `1.5px solid ${selected ? COLORS.brand : COLORS.ink4}`,
            background: selected ? COLORS.brand : COLORS.bgCard,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            zIndex: 5,
          }}
        >
          {selected && <Check size={12} />}
        </button>
      )}

      {/* check de sélection (select) */}
      {!isRead && selected && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: COLORS.brand,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={11} />
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <CompanyAvatar name={company.name} size={32} rounded="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.ink0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {company.name}
          </div>
          {sub && (
            <div
              style={{
                fontSize: 11,
                color: COLORS.ink3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sub}
            </div>
          )}
        </div>

        {/* actions au hover */}
        {isRead ? (
          <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="Actions"
              style={{
                border: "none",
                background: "transparent",
                color: hover || menuOpen ? COLORS.ink2 : "transparent",
                cursor: "pointer",
                display: "inline-flex",
                padding: 2,
              }}
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 4,
                  minWidth: 160,
                  background: COLORS.bgCard,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: RADIUS.md,
                  boxShadow: SHADOWS.md,
                  padding: 4,
                  zIndex: 10,
                }}
              >
                <Link
                  href={`/watchlist/${company.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 12, color: COLORS.ink1, textDecoration: "none", borderRadius: 6 }}
                >
                  <ExternalLink size={13} /> Ouvrir la fiche
                </Link>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove(company);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 12, color: COLORS.err, background: "transparent", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    <Trash2 size={13} /> Retirer de la watchlist
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          hover &&
          !selected && (
            <Link
              href={`/watchlist/${company.id}`}
              onClick={(e) => e.stopPropagation()}
              title="Ouvrir la fiche"
              style={{ color: COLORS.ink3, display: "inline-flex", flexShrink: 0 }}
            >
              <ExternalLink size={13} />
            </Link>
          )
        )}
      </div>

      {/* chip owner */}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: accent ?? "transparent",
            border: accent ? "none" : `1px dashed ${COLORS.ink4}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: owner ? COLORS.ink2 : COLORS.ink4, fontWeight: owner ? 500 : 400 }}>
          {owner ?? "Non attribué"}
        </span>
      </div>
    </div>
  );
}
