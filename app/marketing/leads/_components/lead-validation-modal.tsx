"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, Sparkles, FlaskConical, ExternalLink } from "lucide-react";
import type { LeadWithAnalysis, LeadAnalysis } from "@/lib/marketing-types";
import { DEAL_ORIGINS, DEFAULT_DEAL_ORIGIN, OFFER_TYPES, isDealOrigin, originNeedsPartner } from "@/lib/leads/origin";

const ACCENT = "#f01563";
const GREEN = "#10b981";

interface SalesUserOption {
  id: string;            // app user UUID
  name: string;
  hubspotOwnerId: string | null;
  slackDisplayName: string | null;
}

interface SalesUsersResponse {
  users: SalesUserOption[];
  myUserId: string | null;
}

interface AnalyzeResponse {
  analysis?: LeadAnalysis;
  error?: string;
}

type CreationMode = "legacy" | "prospection" | "frozen";

interface CreationConfigResponse {
  creation: CreationMode | null;
  error: string | null;
}

interface FinalizeResponse {
  ok?: boolean;
  dealId?: string;
  dealName?: string;
  dealUrl?: string | null;
  test?: boolean;
  linked?: boolean;
  contactId?: string;
  companyId?: string;
  skipped?: boolean;
  message?: string;
  testNotifSent?: boolean;
  slackWarnings?: string[];
  error?: string;
}

interface FinalizeStateResponse {
  validationStatus?: string;
  dealId?: string | null;
  finalized?: boolean;
}

// Netlify coupe la réponse d'une fonction synchrone à ~26s alors que celle-ci
// continue de tourner : le deal peut donc être créé sans que le navigateur
// l'apprenne. Plutôt que d'afficher une erreur (et de pousser à un retry qui
// créerait un doublon), on redemande l'état réel au serveur pendant quelques
// secondes, le temps que la fonction termine son écriture en base.
async function pollFinalized(leadId: string, attempts = 5): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await fetch(`/api/marketing/leads/${leadId}/finalize`);
      if (!res.ok) continue;
      const data = (await res.json()) as FinalizeStateResponse;
      if (data.finalized) return true;
    } catch {
      // réseau encore instable : on retente
    }
  }
  return false;
}

interface Props {
  lead: LeadWithAnalysis | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  userId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  /** Canal marketing ("How did you hear about us"), texte libre. */
  source: string;
  dealName: string;
  /** Propriété HubSpot `origin` (Source), obligatoire. */
  origin: string;
  offerTypes: string[];
  referringPartner: string;
  asTest: boolean;
  dealAction: "create" | "link";
}

const EMPTY_FORM: FormState = {
  userId: "",
  companyName: "",
  contactName: "",
  contactEmail: "",
  source: "",
  dealName: "",
  origin: DEFAULT_DEAL_ORIGIN,
  offerTypes: [],
  referringPartner: "",
  asTest: false,
  dealAction: "create",
};

function buildForm(analysis: LeadAnalysis | null, myUserId: string | null): FormState {
  // Une carte trouvée par l'email du lead et encore ouverte : on propose de la
  // rattacher plutôt que d'en créer une seconde.
  const sureOpenDeal = !!analysis?.hubspot_deal_id && analysis.match_strategy === "email" && analysis.deal_is_closed !== true;
  return {
    ...EMPTY_FORM,
    userId: myUserId ?? "",
    companyName: analysis?.extracted_company ?? "",
    contactName: analysis?.extracted_name ?? "",
    contactEmail: analysis?.extracted_email ?? "",
    source: analysis?.extracted_source ?? "",
    dealName: analysis?.extracted_company ?? "",
    dealAction: sureOpenDeal ? "link" : "create",
  };
}

export default function LeadValidationModal({ lead, onClose, onSuccess }: Props) {
  const [salesUsers, setSalesUsers] = useState<SalesUserOption[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [analysis, setAnalysis] = useState<LeadAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ dealName: string; dealUrl: string | null } | null>(null);

  useEffect(() => {
    if (!lead) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lead]);

  useEffect(() => {
    if (!lead) return;
    setTestResult(null);
    setConfigError(null);
    fetch("/api/marketing/leads/creation-config")
      .then((r) => r.json())
      .then((data: CreationConfigResponse) => {
        setCreationMode(data.creation);
        setConfigError(data.error);
      })
      .catch(() => setConfigError("Failed to load the creation settings"));
  }, [lead]);

  useEffect(() => {
    if (!lead) return;
    setError(null);
    setWarnings([]);
    setLoadingUsers(true);
    fetch("/api/marketing/leads/sales-users")
      .then((r) => r.json())
      .then((data: SalesUsersResponse) => {
        setSalesUsers(data.users ?? []);
        setMyUserId(data.myUserId ?? null);
      })
      .catch(() => setError("Failed to load sales reps"))
      .finally(() => setLoadingUsers(false));
  }, [lead]);

  useEffect(() => {
    if (!lead) {
      setAnalysis(null);
      setForm(EMPTY_FORM);
      return;
    }
    const existing = lead.analysis;
    const needsAnalyze =
      !existing ||
      existing.status === "pending" ||
      existing.status === "error" ||
      lead.analysis_status === "pending" ||
      lead.analysis_status === "error";
    if (!needsAnalyze && existing) {
      setAnalysis(existing);
      setForm((prev) => ({
        ...buildForm(existing, myUserId),
        userId: prev.userId || myUserId || "",
      }));
      return;
    }
    setLoadingAnalysis(true);
    fetch(`/api/marketing/leads/${lead.id}/analyze`, { method: "POST" })
      .then(async (r) => {
        const data = (await r.json()) as AnalyzeResponse;
        if (!r.ok) throw new Error(data.error ?? "Analysis failed");
        return data.analysis ?? null;
      })
      .then((a) => {
        setAnalysis(a);
        setForm(buildForm(a, myUserId));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Analysis failed"))
      .finally(() => setLoadingAnalysis(false));
  }, [lead, myUserId]);

  useEffect(() => {
    if (analysis && form.userId === "" && myUserId) {
      setForm((prev) => ({ ...prev, userId: myUserId }));
    }
  }, [analysis, myUserId, form.userId]);

  if (!lead) return null;

  const selectedUser = salesUsers.find((u) => u.id === form.userId) ?? null;
  const missingHubspotOwner = Boolean(selectedUser && !selectedUser.hubspotOwnerId);
  const missingSlackDisplay = Boolean(selectedUser && !selectedUser.slackDisplayName);

  const needsPartner = isDealOrigin(form.origin) && originNeedsPartner(form.origin);
  const existingDealId = analysis?.hubspot_deal_id ?? null;
  const showLinkChoice = !form.asTest && creationMode === "prospection" && !!existingDealId;
  const frozen = creationMode === "frozen" && !form.asTest;

  const canSubmit =
    !submitting &&
    !loadingAnalysis &&
    creationMode !== null &&
    !frozen &&
    form.userId.trim().length > 0 &&
    !missingHubspotOwner &&
    form.companyName.trim().length > 0 &&
    form.contactEmail.trim().length > 0 &&
    form.dealName.trim().length > 0 &&
    isDealOrigin(form.origin) &&
    (!needsPartner || form.referringPartner.trim().length > 0);

  const toggleOffer = (value: string) =>
    setForm((prev) => ({
      ...prev,
      offerTypes: prev.offerTypes.includes(value) ? prev.offerTypes.filter((v) => v !== value) : [...prev.offerTypes, value],
    }));

  const handleSubmit = async () => {
    if (!canSubmit || !lead) return;
    setSubmitting(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch(`/api/marketing/leads/${lead.id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: form.userId,
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim().toLowerCase(),
          dealName: form.dealName.trim(),
          source: form.source.trim() || null,
          origin: form.origin,
          offerTypes: form.offerTypes,
          referringPartner: needsPartner ? form.referringPartner.trim() : null,
          asTest: form.asTest,
          dealAction: showLinkChoice ? form.dealAction : "create",
        }),
      });
      // The server always tries to return JSON, but a Netlify sync-function
      // timeout (~26s) can still produce an empty/non-JSON body, so parse
      // defensively instead of letting res.json() throw "Unexpected end of JSON input".
      const raw = await res.text();
      let data: FinalizeResponse | null = null;
      try {
        data = raw ? (JSON.parse(raw) as FinalizeResponse) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.ok) {
        // Netlify coupe la réponse à ~26s alors que la fonction continue de
        // tourner : un 502/504 ne veut donc PAS dire "échec". On va relire
        // l'état réel avant de crier à l'erreur, sinon on pousse l'admin à
        // recliquer sur un lead déjà traité.
        if (res.status === 504 || res.status === 502) {
          const finalized = await pollFinalized(lead.id);
          if (finalized) {
            onSuccess();
            onClose();
            return;
          }
        }
        throw new Error(
          data?.error ??
            (res.status === 504 || res.status === 502
              ? "The server took too long to respond (timeout) and the deal was not created. You can retry."
              : `Deal creation failed (HTTP ${res.status})`),
        );
      }
      if (data.slackWarnings && data.slackWarnings.length > 0) {
        setWarnings(data.slackWarnings);
      }
      if (data.test) {
        // Carte TEST : le lead n'est pas consommé, on reste dans la fenêtre.
        setTestResult({ dealName: data.dealName ?? form.dealName, dealUrl: data.dealUrl ?? null });
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#111", margin: 0 }}>
            Validate lead and create deal
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#888",
              padding: 4,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loadingAnalysis ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#888",
              fontSize: 13,
              padding: 16,
              background: "#fafafa",
              borderRadius: 8,
            }}
          >
            <Loader2 size={16} className="animate-spin" />
            Claude analysis in progress, extracting the prospect&apos;s details…
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Owner (sales)" required>
              <select
                value={form.userId}
                onChange={(e) => setForm((prev) => ({ ...prev, userId: e.target.value }))}
                disabled={loadingUsers || submitting}
                style={inputStyle()}
              >
                <option value="">{loadingUsers ? "Loading…" : "Select a sales rep"}</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {missingHubspotOwner && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  This user has no hubspot_owner_id configured. Add it in /admin before
                  creating the deal.
                </div>
              )}
              {missingSlackDisplay && !missingHubspotOwner && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  This user has no slack_display_name. The Slack tag will use their name as
                  plain text (no notification).
                </div>
              )}
            </Field>

            <Field label="Company name" required>
              <input
                type="text"
                value={form.companyName}
                onChange={(e) =>
                  setForm((prev) => {
                    const dealMatchesCompany = prev.dealName === prev.companyName;
                    return {
                      ...prev,
                      companyName: e.target.value,
                      dealName: dealMatchesCompany ? e.target.value : prev.dealName,
                    };
                  })
                }
                disabled={submitting}
                style={inputStyle()}
              />
            </Field>

            <Field label="Contact (name)">
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
            </Field>

            <Field label="Contact (email)" required>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm((prev) => ({ ...prev, contactEmail: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
            </Field>

            <Field label="Deal name" required>
              <input
                type="text"
                value={form.dealName}
                onChange={(e) => setForm((prev) => ({ ...prev, dealName: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
            </Field>

            <Field label="Source" required>
              <select
                value={form.origin}
                onChange={(e) => setForm((prev) => ({ ...prev, origin: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              >
                {DEAL_ORIGINS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            {needsPartner && (
              <Field label="Referring partner" required>
                <input
                  type="text"
                  value={form.referringPartner}
                  placeholder="Partner company"
                  onChange={(e) => setForm((prev) => ({ ...prev, referringPartner: e.target.value }))}
                  disabled={submitting}
                  style={inputStyle()}
                />
              </Field>
            )}

            <Field label="Offer">
              <div style={{ display: "flex", gap: 16, paddingTop: 2 }}>
                {OFFER_TYPES.map((o) => (
                  <label key={o.value} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#111", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.offerTypes.includes(o.value)}
                      onChange={() => toggleOffer(o.value)}
                      disabled={submitting}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Marketing channel">
              <input
                type="text"
                value={form.source}
                placeholder="How did you hear about us (e.g. LinkedIn, Google…)"
                onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
              {analysis?.extracted_source && (
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  <Sparkles size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  Extracted by Claude: <em>{analysis.extracted_source}</em>
                </div>
              )}
            </Field>

            {showLinkChoice && (
              <div style={{ fontSize: 12, color: "#333", background: "#fafafa", border: "1px solid #eee", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  An open card already exists for this lead: <strong>{analysis?.deal_name ?? existingDealId}</strong>
                  {analysis?.deal_stage_label ? ` (${analysis.deal_stage_label})` : ""}
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" checked={form.dealAction === "link"} onChange={() => setForm((prev) => ({ ...prev, dealAction: "link" }))} disabled={submitting} />
                  Link to this deal (no new card)
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" checked={form.dealAction === "create"} onChange={() => setForm((prev) => ({ ...prev, dealAction: "create" }))} disabled={submitting} />
                  Create a new card
                </label>
              </div>
            )}

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#555", background: form.asTest ? "#eff6ff" : "transparent", border: "1px dashed #c7d2fe", borderRadius: 8, padding: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.asTest}
                onChange={(e) => setForm((prev) => ({ ...prev, asTest: e.target.checked }))}
                disabled={submitting}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 600, color: "#1e3a8a", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <FlaskConical size={12} /> Create as TEST
                </span>
                <br />
                Creates a &quot;TEST - &quot; card in Prospection / R1 scheduled, linked to the test contact (never to this prospect).
                The lead stays to validate and nothing is sent to the sales rep.
              </span>
            </label>

            {analysis?.extraction_notes && (
              <div
                style={{
                  fontSize: 11,
                  color: "#666",
                  background: "#fafafa",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #eee",
                }}
              >
                <strong style={{ color: "#888" }}>Claude notes:</strong> {analysis.extraction_notes}
              </div>
            )}
          </div>
        )}

        {configError && (
          <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: 10, borderRadius: 6 }}>
            Creation settings unavailable: {configError}
          </div>
        )}

        {frozen && (
          <div style={{ fontSize: 12, color: "#b45309", background: "#fef3c7", padding: 10, borderRadius: 6 }}>
            Deal creation is paused during the HubSpot cutover. Create the card in HubSpot for now, or tick &quot;Create as TEST&quot;.
          </div>
        )}

        {testResult && (
          <div style={{ fontSize: 12, color: "#1e3a8a", background: "#eff6ff", padding: 10, borderRadius: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <FlaskConical size={13} /> TEST card created:
            {testResult.dealUrl ? (
              <a href={testResult.dealUrl} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
                {testResult.dealName} <ExternalLink size={11} />
              </a>
            ) : (
              <strong>{testResult.dealName}</strong>
            )}
            <span style={{ color: "#555" }}>(the lead was not validated)</span>
          </div>
        )}

        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#dc2626",
              background: "#fee2e2",
              padding: 10,
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        {warnings.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: "#b45309",
              background: "#fef3c7",
              padding: 10,
              borderRadius: 6,
            }}
          >
            Deal created, but Slack returned: {warnings.join(" · ")}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid #f4f4f4",
            paddingTop: 16,
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "8px 14px",
              background: "#fff",
              color: "#555",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "8px 14px",
              background: canSubmit ? GREEN : "#a7f3d0",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : form.asTest ? <FlaskConical size={14} /> : <Check size={14} />}
            {form.asTest ? "Create TEST card" : showLinkChoice && form.dealAction === "link" ? "Link and validate" : "Create deal and validate"}
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
          {form.asTest
            ? "TEST card on the test contact, Prospection pipeline, R1 scheduled. You get the Slack message in DM."
            : creationMode === "prospection"
              ? "This will create the contact and the card on HubSpot (Prospection pipeline, R1 scheduled) and notify the owner on Slack. An existing company keeps its owner."
              : "This will create the company, contact, and deal on HubSpot (Sales pipeline, Discovery stage) and notify the owner on Slack. An existing company keeps its owner."}
        </div>

        {!error && !loadingAnalysis && analysis?.extracted_email && (
          <div style={{ fontSize: 11, color: ACCENT, textAlign: "center" }}>
            Claude analysis OK: prospect identified
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    fontSize: 13,
    padding: "8px 10px",
    border: "1px solid #e5e5e5",
    borderRadius: 6,
    background: "#fff",
    outline: "none",
    color: "#111",
  };
}
