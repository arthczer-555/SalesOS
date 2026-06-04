"use client";

import * as React from "react";
import { Upload, Loader2, AlertTriangle, Check, Building2, Users } from "lucide-react";
import { COLORS, RADIUS } from "@/lib/design/tokens";
import { Overlay, Header } from "./configure-reps-dialog";
import {
  parseCsv,
  autoDetectMapping,
  rowToProfile,
  FIELD_LABELS,
  type CsvField,
  type ParsedCsv,
} from "@/lib/csv/contacts-csv";
import { saveList } from "@/lib/hooks/use-enrichment";
import type { EnrichmentProfile, HubspotPushState, HubspotPushSummary } from "@/lib/intel-types";
import type { ResolvedCompany } from "@/app/api/intel/admin/scope-companies/resolve-hubspot/route";

// Set minimal de domaines grand public (ne pas les envoyer comme domaine company).
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "free.fr", "orange.fr", "sfr.fr",
  "wanadoo.fr", "laposte.net", "aol.com",
]);

const FIELD_ORDER: CsvField[] = [
  "ignore", "firstName", "lastName", "fullName", "company", "email", "jobTitle", "linkedinUrl", "headline",
];

function businessDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const dom = email.slice(at + 1).toLowerCase().trim();
  if (!dom || PUBLIC_DOMAINS.has(dom)) return null;
  return dom;
}

export function EnrichWizard({
  reps,
  onClose,
  onDone,
}: {
  reps: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = React.useState<Record<number, CsvField>>({});
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [resolving, setResolving] = React.useState(false);
  const [resolved, setResolved] = React.useState<ResolvedCompany[] | null>(null);
  const [createMissing, setCreateMissing] = React.useState(false);
  const [addToOwner, setAddToOwner] = React.useState<string>("");

  const [launching, setLaunching] = React.useState(false);
  const [pushState, setPushState] = React.useState<HubspotPushState | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Profils construits depuis le CSV mappé ───────────────────────────
  const profiles: EnrichmentProfile[] = React.useMemo(() => {
    if (!parsed) return [];
    return parsed.rows
      .map((r) => rowToProfile(r, mapping, { requireNameAndCompany: false }))
      .filter((p): p is EnrichmentProfile => !!p);
  }, [parsed, mapping]);

  const distinctCompanies = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of profiles) {
      const name = (p.company ?? "").trim();
      if (!name) continue;
      const low = name.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      out.push(name);
    }
    return out;
  }, [profiles]);

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      const p = parseCsv(text);
      setParsed(p);
      setMapping(autoDetectMapping(p.headers));
    };
    reader.readAsText(file);
  }

  async function goReview() {
    setStep(2);
    setResolved(null);
    setResolving(true);
    // domaines par company (1er email pro rencontré)
    const domains: Record<string, string> = {};
    for (const p of profiles) {
      const name = (p.company ?? "").trim();
      if (!name) continue;
      if (domains[name]) continue;
      const dom = businessDomain(p.email);
      if (dom) domains[name] = dom;
    }
    try {
      const r = await fetch("/api/intel/admin/scope-companies/resolve-hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: distinctCompanies, domains }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erreur");
      setResolved(j.companies ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setResolving(false);
    }
  }

  async function launch() {
    setLaunching(true);
    setErr(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const list = await saveList({
        name: `Enrich ${fileName ?? "CSV"} ${stamp}`.slice(0, 200),
        source: "mixed",
        criteria: { source: "csv-enrich" },
        results: profiles,
      });
      const r = await fetch(`/api/intel/enrich/lists/${list.id}/push-hubspot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createMissingCompanies: createMissing,
          addToScopeOwner: addToOwner || null,
        }),
      });
      if (!r.ok && r.status !== 202) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Erreur lancement");
      }
      setStep(3);
      setPushState({ status: "running", startedAt: new Date().toISOString() });
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/intel/enrich/lists");
          if (!res.ok) return;
          const data = await res.json();
          const row = (data.lists as Array<{ id: string; criteria: unknown }>).find((l) => l.id === list.id);
          const ps = (row?.criteria as { hubspotPush?: HubspotPushState } | null)?.hubspotPush ?? null;
          if (ps) setPushState(ps);
          if (ps && ps.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            onDone();
          }
        } catch { /* retry */ }
      }, 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
      setStep(2);
    } finally {
      setLaunching(false);
    }
  }

  const existingCount = resolved?.filter((c) => c.status === "existing").length ?? 0;
  const missingCount = resolved?.filter((c) => c.status === "missing").length ?? 0;
  const withEmail = profiles.filter((p) => (p.email ?? "").trim()).length;

  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 620, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <Header title="Enrichir — CSV → HubSpot" onClose={onClose} />
        <Steps step={step} />

        {err && (
          <div style={{ margin: "10px 16px 0", padding: "8px 12px", background: COLORS.errBg, color: COLORS.err, borderRadius: 8, fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* ── ÉTAPE 1 : upload + mapping ── */}
          {step === 1 && (
            <>
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {!parsed ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f?.name.endsWith(".csv")) handleFile(f); }}
                  style={{
                    border: `2px dashed ${dragging ? COLORS.brand : COLORS.lineStrong}`,
                    borderRadius: RADIUS.lg,
                    padding: 40,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    background: dragging ? COLORS.brandTintSoft : COLORS.bgSoft,
                  }}
                >
                  <Upload size={26} style={{ color: COLORS.ink4 }} />
                  <span style={{ fontSize: 13, color: COLORS.ink2 }}>
                    Glisse un CSV de contacts ou <span style={{ color: COLORS.brand }}>parcours</span>
                  </span>
                  <span style={{ fontSize: 11, color: COLORS.ink4 }}>Colonnes : prénom, nom, email, entreprise, poste…</span>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: COLORS.ink1, fontWeight: 600 }}>{fileName}</span>
                    <span style={{ fontSize: 11, color: COLORS.ink3 }}>{parsed.rows.length} lignes · {profiles.length} exploitables</span>
                    <button type="button" onClick={() => { setParsed(null); setFileName(null); }} style={linkBtn()}>Changer</button>
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 8 }}>Associe les colonnes :</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {parsed.headers.map((h, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: COLORS.ink2, flex: "0 0 38%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={h}>{h || `Col ${i + 1}`}</span>
                        <select
                          value={mapping[i] ?? "ignore"}
                          onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value as CsvField }))}
                          style={{ flex: 1, padding: "5px 7px", fontSize: 11, borderRadius: 6, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, cursor: "pointer" }}
                        >
                          {FIELD_ORDER.map((f) => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── ÉTAPE 2 : review companies ── */}
          {step === 2 && (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <Stat icon={<Users size={14} />} label="Contacts" value={`${profiles.length}`} sub={`${withEmail} avec email`} />
                <Stat icon={<Building2 size={14} />} label="Companies" value={`${distinctCompanies.length}`} sub={resolving ? "résolution…" : `${existingCount} existantes`} />
                <Stat icon={<AlertTriangle size={14} />} label="Manquantes" value={resolving ? "…" : `${missingCount}`} sub="dans HubSpot" warn={missingCount > 0} />
              </div>

              {resolving ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center", color: COLORS.ink3, fontSize: 12 }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: COLORS.brand }} /> Résolution des companies dans HubSpot…
                </div>
              ) : (
                <>
                  {missingCount > 0 && (
                    <div style={{ border: `1px solid ${COLORS.warn}33`, background: COLORS.warnBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: COLORS.warn, marginBottom: 6 }}>
                        <AlertTriangle size={13} /> {missingCount} company{missingCount > 1 ? "s" : ""} absente{missingCount > 1 ? "s" : ""} de HubSpot
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.ink2, marginBottom: 8, maxHeight: 80, overflowY: "auto" }}>
                        {resolved!.filter((c) => c.status === "missing").map((c) => c.name).join(", ")}
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink1, cursor: "pointer" }}>
                        <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                        Créer ces companies dans HubSpot (domaine pro inféré quand dispo)
                      </label>
                    </div>
                  )}

                  <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: RADIUS.md, padding: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink1, marginBottom: addToOwner ? 8 : 0, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!addToOwner} onChange={(e) => setAddToOwner(e.target.checked ? (reps[0]?.name ?? "") : "")} />
                      Ajouter ces companies à la watchlist d&apos;un sales
                    </label>
                    {addToOwner !== "" && (
                      <select value={addToOwner} onChange={(e) => setAddToOwner(e.target.value)} style={{ width: "100%", padding: "7px 9px", fontSize: 12, borderRadius: 7, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, cursor: "pointer" }}>
                        {reps.length === 0 && <option value="">Aucun sales (configure le roster)</option>}
                        {reps.map((r) => (
                          <option key={r.id} value={r.name}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── ÉTAPE 3 : progress + summary ── */}
          {step === 3 && (
            <PushResult state={pushState} />
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={onClose} style={ghostBtn()}>
            {step === 3 && pushState?.status !== "running" ? "Fermer" : "Annuler"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)} style={ghostBtn()}>Retour</button>
            )}
            {step === 1 && (
              <button type="button" disabled={profiles.length === 0} onClick={goReview} style={primaryBtn(profiles.length > 0)}>
                Continuer ({profiles.length})
              </button>
            )}
            {step === 2 && (
              <button type="button" disabled={resolving || launching} onClick={launch} style={primaryBtn(!resolving && !launching)}>
                {launching ? <Loader2 size={13} className="animate-spin" /> : null} Lancer l&apos;envoi
              </button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function PushResult({ state }: { state: HubspotPushState | null }) {
  if (!state || state.status === "running") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 30, color: COLORS.ink2 }}>
        <Loader2 size={22} className="animate-spin" style={{ color: COLORS.brand }} />
        <span style={{ fontSize: 13 }}>Envoi vers HubSpot en cours…</span>
        <span style={{ fontSize: 11, color: COLORS.ink3 }}>Tu peux fermer cette fenêtre, le traitement continue côté serveur.</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={{ padding: 16, background: COLORS.errBg, color: COLORS.err, borderRadius: RADIUS.md, fontSize: 12 }}>
        Échec : {state.error ?? "erreur inconnue"}
      </div>
    );
  }
  const s = state.summary as HubspotPushSummary | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 12 }}>
      <span style={{ width: 44, height: 44, borderRadius: 999, background: COLORS.okBg, color: COLORS.ok, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Check size={22} />
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>Envoi terminé</span>
      {s && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
          <Metric label="Contacts créés" value={s.created} />
          <Metric label="Déjà présents" value={s.existing} />
          <Metric label="Companies associées" value={s.companyAssociated} />
          <Metric label="Companies créées" value={s.companyCreated} accent={COLORS.brand} />
          <Metric label="Ajoutées au scope" value={s.scopeUpserted} />
          <Metric label="Sans email" value={s.skippedNoEmail} />
          {s.errors > 0 && <Metric label="Erreurs" value={s.errors} accent={COLORS.err} />}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: RADIUS.md, padding: "8px 10px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? COLORS.ink0 }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

function Stat({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div style={{ flex: 1, border: `1px solid ${warn ? COLORS.warn + "44" : COLORS.line}`, background: warn ? COLORS.warnBg : COLORS.bgCard, borderRadius: RADIUS.md, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: warn ? COLORS.warn : COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? COLORS.warn : COLORS.ink0, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.ink3 }}>{sub}</div>
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Importer", "Vérifier", "Envoyer"];
  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${COLORS.line}` }}>
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: active || done ? COLORS.brand : COLORS.bgSoft,
                color: active || done ? "#fff" : COLORS.ink4,
              }}
            >
              {done ? <Check size={11} /> : n}
            </span>
            <span style={{ fontSize: 11, fontWeight: active ? 600 : 500, color: active ? COLORS.ink0 : COLORS.ink3 }}>{l}</span>
            {i < 2 && <span style={{ flex: 1, height: 1, background: COLORS.line }} />}
          </div>
        );
      })}
    </div>
  );
}

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    background: enabled ? COLORS.brand : COLORS.bgSoft,
    color: enabled ? "#fff" : COLORS.ink4,
    cursor: enabled ? "pointer" : "default",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function linkBtn(): React.CSSProperties {
  return { border: "none", background: "transparent", color: COLORS.brand, fontSize: 11, cursor: "pointer", padding: 0 };
}
