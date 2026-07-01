"use client";

import * as React from "react";
import useSWR from "swr";
import { Users, History, ExternalLink, Loader2, Mail, MailPlus, Check, Phone, PhoneCall, Copy, BadgeCheck } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";
import { ContactHistoryModal } from "./contact-history-modal";
import { VerifyRolesModal } from "./verify-roles-modal";
import { useOutreachCounts } from "@/lib/hooks/use-outreach-counts";
import type { DraftRecipient } from "./mail-drafter";
import type { CompanyContactsResponse } from "@/app/api/watchlist/companies/[id]/contacts/route";
import type { VerifyRolesResponse } from "@/app/api/watchlist/companies/[id]/verify-roles/route";

// Date d'ajout du contact dans HubSpot, formatée en anglais (UI EN). Renvoie
// null si la date est absente ou invalide pour ne rien afficher dans ce cas.
function formatAddedDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function ContactsCard({
  companyId,
  onProspect,
}: {
  companyId: string;
  onProspect?: (recipients: DraftRecipient[]) => void;
}) {
  const { data, isLoading, mutate } = useSWR<CompanyContactsResponse>(
    `/api/watchlist/companies/${companyId}/contacts`,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const [historyTarget, setHistoryTarget] = React.useState<{ name: string; email: string; contactId: string } | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // État du reveal de numéro par contact ("revealing" pendant l'attente async,
  // "error" si l'appel a échoué ou le webhook n'a rien renvoyé à temps).
  const [phoneState, setPhoneState] = React.useState<Record<string, "revealing" | "error">>({});
  // Contact dont le popover "Call" est ouvert (un seul à la fois), + feedback copie.
  const [callOpen, setCallOpen] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  // Vérification des postes/entreprises via Apollo : état du run + résultat
  // (ouvre la modale de revue) + message d'erreur transitoire.
  const [verifying, setVerifying] = React.useState(false);
  const [verifyResult, setVerifyResult] = React.useState<VerifyRolesResponse | null>(null);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);
  const [verifyFlash, setVerifyFlash] = React.useState<string | null>(null);

  const runVerify = React.useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    setVerifyFlash(null);
    try {
      const res = await fetch(`/api/watchlist/companies/${companyId}/verify-roles`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as VerifyRolesResponse & { error?: string };
      if (!res.ok) throw new Error(json?.error || "Verification failed");
      if (!json.apolloConfigured) {
        setVerifyError("Apollo is not configured.");
        return;
      }
      setVerifyResult(json);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [companyId]);

  // Garde de montage : stoppe le polling téléphone récursif après démontage
  // (navigation) pour éviter les fetch et setState orphelins.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reveal Apollo (crédit) -> écrit le numéro sur HubSpot. Fast-path si Apollo
  // renvoie le numéro tout de suite ; sinon on poll le GET (le webhook Apollo
  // remplit le numéro côté HubSpot de façon asynchrone).
  const revealNumber = React.useCallback(
    async (contactId: string) => {
      setPhoneState((s) => ({ ...s, [contactId]: "revealing" }));
      const clearState = () =>
        setPhoneState((s) => {
          const next = { ...s };
          delete next[contactId];
          return next;
        });
      try {
        const res = await fetch(`/api/watchlist/companies/${companyId}/contacts/${contactId}/phone`, {
          method: "POST",
        });
        const json = (await res.json().catch(() => ({}))) as { status?: string; phone?: string; error?: string };
        if (!res.ok) throw new Error(json?.error || "reveal failed");
        if (json.status === "done" && json.phone) {
          await mutate();
          clearState();
          return;
        }
        // "pending" : Apollo enverra le numéro au webhook. On poll jusqu'à 60s.
        const startedAt = Date.now();
        const tick = async () => {
          if (!mountedRef.current) return;
          try {
            const r = await fetch(`/api/watchlist/companies/${companyId}/contacts/${contactId}/phone`);
            const j = (await r.json().catch(() => ({}))) as { phone?: string | null };
            if (!mountedRef.current) return;
            if (j?.phone) {
              await mutate();
              clearState();
              return;
            }
          } catch {
            /* ignore et on continue à poller */
          }
          if (!mountedRef.current) return;
          if (Date.now() - startedAt > 60_000) {
            setPhoneState((s) => ({ ...s, [contactId]: "error" }));
            return;
          }
          window.setTimeout(tick, 4000);
        };
        window.setTimeout(tick, 4000);
      } catch {
        setPhoneState((s) => ({ ...s, [contactId]: "error" }));
      }
    },
    [companyId, mutate],
  );

  const contacts = data?.contacts ?? [];
  const withEmail = contacts.filter((c) => c.email);
  const contactEmails = React.useMemo(
    () => (data?.contacts ?? []).map((c) => c.email).filter((e): e is string => !!e),
    [data],
  );
  const { countByEmail } = useOutreachCounts(contactEmails);

  function nameOf(c: (typeof contacts)[number]) {
    return `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "Contact";
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelected() {
    if (!onProspect) return;
    const picked = withEmail
      .filter((c) => selected.has(c.id))
      .map((c) => ({ name: nameOf(c), email: c.email as string }));
    if (picked.length > 0) onProspect(picked);
    setSelected(new Set());
  }

  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        boxShadow: SHADOWS.card,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "14px 16px",
        }}
      >
        <span style={{ display: "inline-flex", color: COLORS.ink3 }}>
          <Users size={16} />
        </span>
        <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.ink0 }}>
          HubSpot contacts
        </h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>{contacts.length}</span>
        )}
        {contacts.length > 0 && (
          <button
            type="button"
            onClick={runVerify}
            disabled={verifying}
            title="Check job titles & companies via Apollo"
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 7,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: verifying ? COLORS.ink3 : COLORS.ink1,
              cursor: verifying ? "default" : "pointer",
            }}
          >
            {verifying ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />}
            {verifying ? "Verifying…" : "Verify roles"}
          </button>
        )}
        {onProspect && selected.size > 0 && (
          <button
            type="button"
            onClick={addSelected}
            style={{
              marginLeft: contacts.length > 0 ? 0 : "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 7,
              border: "none",
              background: COLORS.brand,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            <MailPlus size={12} /> Add {selected.size} to email
          </button>
        )}
        {isLoading && (
          <Loader2
            size={12}
            className="animate-spin"
            style={{ color: COLORS.brand, marginLeft: contacts.length > 0 || selected.size > 0 ? 0 : "auto" }}
          />
        )}
      </header>

      {(verifyError || verifyFlash) && (
        <div
          style={{
            margin: "0 16px 8px",
            fontSize: 11.5,
            color: verifyError ? COLORS.err : COLORS.ok,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {verifyError ?? verifyFlash}
        </div>
      )}

      <div style={{ padding: "0 8px 8px" }}>
        {isLoading && contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>Loading contacts…</p>
        ) : data?.error && contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.err }}>
            Could not load contacts: {data.error}
          </p>
        ) : contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>
            {data?.hubspot_company_id
              ? "No contacts associated with this company in HubSpot."
              : "Company not linked to HubSpot (import from HubSpot to link contacts)."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {contacts.map((c) => {
              const name = nameOf(c);
              return (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 8px",
                    borderRadius: 8,
                  }}
                >
                  {/* Ligne du nom : checkbox + nom + badge. Le nom reste toujours lisible,
                      les actions sont sur leur propre ligne plus bas (cf. zone Actions). */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {onProspect && c.email && (
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      title="Select for email"
                      style={{ accentColor: COLORS.brand, width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
                    />
                  )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                      {c.email ? (
                        <button
                          type="button"
                          onClick={() => setHistoryTarget({ name, email: c.email as string, contactId: c.id })}
                          title="View history"
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            color: COLORS.ink0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {name}
                        </button>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {name}
                        </span>
                      )}
                      {c.email && (
                        <span
                          title={`${countByEmail(c.email)} email${countByEmail(c.email) > 1 ? "s" : ""} sent from SalesOS to this contact`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "2px 7px",
                            borderRadius: 99,
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            background: countByEmail(c.email) > 0 ? "#fff8fb" : COLORS.bgSoft,
                            color: countByEmail(c.email) > 0 ? "#f01563" : COLORS.ink3,
                            border: `1px solid ${countByEmail(c.email) > 0 ? "#fbd5e3" : COLORS.line}`,
                          }}
                        >
                          <Mail size={10} />
                          {countByEmail(c.email)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Titre / email / date sur toute la largeur, alignés sous le nom. */}
                  <div style={{ paddingLeft: onProspect && c.email ? 25 : 0 }}>
                    <div style={{ fontSize: 11, color: COLORS.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.jobtitle ? c.jobtitle : "—"}
                    </div>
                    {c.email && (
                      <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.email}
                      </div>
                    )}
                    {formatAddedDate(c.created_at) && (
                      <div style={{ fontSize: 10, color: COLORS.ink3, whiteSpace: "nowrap" }}>
                        Added to HubSpot · {formatAddedDate(c.created_at)}
                      </div>
                    )}
                  </div>
                  {/* Actions : ligne dédiée qui passe à la ligne (flexWrap) sur écran étroit
                      pour ne jamais écraser le nom du contact (bug d'affichage sur laptop). */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 6,
                      paddingLeft: onProspect && c.email ? 25 : 0,
                    }}
                  >
                  {!c.phone &&
                    (phoneState[c.id] === "revealing" ? (
                      <span
                        title="Revealing number…"
                        style={{ ...iconBtn(), width: "auto", padding: "0 9px", gap: 5, cursor: "default" }}
                      >
                        <Loader2 size={12} className="animate-spin" style={{ color: COLORS.brand }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>Revealing…</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revealNumber(c.id)}
                        title={
                          phoneState[c.id] === "error"
                            ? "Reveal failed — click to retry"
                            : "Reveal phone number (Apollo)"
                        }
                        style={{
                          ...iconBtn(),
                          width: "auto",
                          padding: "0 9px",
                          gap: 5,
                          color: phoneState[c.id] === "error" ? "#dc2626" : COLORS.brand,
                          borderColor: phoneState[c.id] === "error" ? "#fecaca" : COLORS.line,
                        }}
                      >
                        <Phone size={12} />
                        <span style={{ fontSize: 11, fontWeight: 600 }}>
                          {phoneState[c.id] === "error" ? "Retry" : "Reveal"}
                        </span>
                      </button>
                    ))}
                  {c.phone && (
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setCallOpen((cur) => (cur === c.id ? null : c.id));
                          setCopied(false);
                        }}
                        title="Call"
                        style={iconBtn()}
                      >
                        <Phone size={13} />
                      </button>
                      {callOpen === c.id && (
                        <>
                          {/* Backdrop invisible : ferme le popover au clic en dehors. */}
                          <div onClick={() => setCallOpen(null)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              right: 0,
                              zIndex: 51,
                              width: 212,
                              background: COLORS.bgCard,
                              border: `1px solid ${COLORS.line}`,
                              borderRadius: 10,
                              boxShadow: SHADOWS.card,
                              padding: 12,
                              display: "flex",
                              flexDirection: "column",
                              gap: 9,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                color: COLORS.ink3,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {name}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0, wordBreak: "break-all" }}>
                              {c.phone}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <a href={`tel:${c.phone}`} style={{ ...popBtn(COLORS.brand, "#fff", false), textDecoration: "none" }}>
                                <PhoneCall size={12} /> Call
                              </a>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(c.phone as string);
                                    setCopied(true);
                                  } catch {
                                    /* clipboard indisponible */
                                  }
                                }}
                                style={popBtn(COLORS.bgSoft, COLORS.ink1, true)}
                              >
                                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
                              </button>
                            </div>
                            {c.email && (
                              <a
                                href={`mailto:${c.email}`}
                                title={c.email}
                                style={{
                                  fontSize: 11,
                                  color: COLORS.ink3,
                                  textDecoration: "none",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <Mail size={11} /> {c.email}
                              </a>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {c.email && onProspect && (
                    <button
                      type="button"
                      onClick={() => onProspect([{ name, email: c.email as string }])}
                      title="Add to email (BCC)"
                      style={iconBtn()}
                    >
                      <MailPlus size={13} />
                    </button>
                  )}
                  {c.email && (
                    <button
                      type="button"
                      onClick={() => setHistoryTarget({ name, email: c.email as string, contactId: c.id })}
                      title="Conversation history (SalesOS + HubSpot + Gmail)"
                      style={iconBtn()}
                    >
                      <History size={13} />
                    </button>
                  )}
                  <a
                    href={`https://app.hubspot.com/contacts/_/contact/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in HubSpot"
                    style={{ ...iconBtn(), textDecoration: "none" }}
                  >
                    <ExternalLink size={13} />
                  </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {historyTarget && (
        <ContactHistoryModal
          fullName={historyTarget.name}
          email={historyTarget.email}
          contactId={historyTarget.contactId}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {verifyResult && (
        <VerifyRolesModal
          companyId={companyId}
          result={verifyResult}
          onClose={() => setVerifyResult(null)}
          onApplied={({ titles, companies, failures }) => {
            setVerifyResult(null);
            void mutate();
            if (failures > 0) {
              setVerifyError(`${failures} update${failures > 1 ? "s" : ""} failed.`);
            } else if (titles + companies > 0) {
              const parts = [
                titles ? `${titles} title${titles > 1 ? "s" : ""} updated` : "",
                companies ? `${companies} company change${companies > 1 ? "s" : ""} applied` : "",
              ].filter(Boolean);
              setVerifyFlash(parts.join(" · "));
            }
          }}
        />
      )}
    </section>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    color: COLORS.ink2,
    background: COLORS.bgCard,
    cursor: "pointer",
    flexShrink: 0,
  };
}

// Bouton d'action dans le popover "Call" (Call / Copy).
function popBtn(bg: string, color: string, border: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 30,
    borderRadius: 7,
    border: border ? `1px solid ${COLORS.line}` : "none",
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
