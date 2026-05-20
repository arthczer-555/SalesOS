"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, Sparkles } from "lucide-react";
import type { LeadWithAnalysis, LeadAnalysis } from "@/lib/marketing-types";

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

interface FinalizeResponse {
  ok?: boolean;
  dealId?: string;
  contactId?: string;
  companyId?: string;
  skipped?: boolean;
  message?: string;
  testNotifSent?: boolean;
  slackWarnings?: string[];
  error?: string;
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
  source: string;
  dealName: string;
}

const EMPTY_FORM: FormState = {
  userId: "",
  companyName: "",
  contactName: "",
  contactEmail: "",
  source: "",
  dealName: "",
};

function buildForm(analysis: LeadAnalysis | null, myUserId: string | null): FormState {
  return {
    userId: myUserId ?? "",
    companyName: analysis?.extracted_company ?? "",
    contactName: analysis?.extracted_name ?? "",
    contactEmail: analysis?.extracted_email ?? "",
    source: analysis?.extracted_source ?? "",
    dealName: analysis?.extracted_company ?? "",
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

  useEffect(() => {
    if (!lead) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
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
      .catch(() => setError("Impossible de charger les sales"))
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
        if (!r.ok) throw new Error(data.error ?? "Analyse échouée");
        return data.analysis ?? null;
      })
      .then((a) => {
        setAnalysis(a);
        setForm(buildForm(a, myUserId));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Analyse échouée"))
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

  const canSubmit =
    !submitting &&
    !loadingAnalysis &&
    form.userId.trim().length > 0 &&
    !missingHubspotOwner &&
    form.companyName.trim().length > 0 &&
    form.contactEmail.trim().length > 0 &&
    form.dealName.trim().length > 0;

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
        }),
      });
      const data = (await res.json()) as FinalizeResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Création du deal échouée");
      }
      if (data.slackWarnings && data.slackWarnings.length > 0) {
        setWarnings(data.slackWarnings);
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
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
            Valider le lead et créer le deal
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
            aria-label="Fermer"
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
            Analyse Claude en cours, extraction des coordonnées du prospect…
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
                <option value="">{loadingUsers ? "Chargement…" : "Sélectionner un sales"}</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {missingHubspotOwner && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  Ce user n&apos;a pas de hubspot_owner_id configuré. Ajoute-le dans /admin avant
                  de créer le deal.
                </div>
              )}
              {missingSlackDisplay && !missingHubspotOwner && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  Ce user n&apos;a pas de slack_display_name. Le tag Slack utilisera son nom en
                  texte brut (pas de notification).
                </div>
              )}
            </Field>

            <Field label="Nom de l'entreprise" required>
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

            <Field label="Contact (nom)">
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

            <Field label="Nom du deal" required>
              <input
                type="text"
                value={form.dealName}
                onChange={(e) => setForm((prev) => ({ ...prev, dealName: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
            </Field>

            <Field label="Origine du lead">
              <input
                type="text"
                value={form.source}
                placeholder="Ex: LinkedIn, Recommandation, Site web…"
                onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                disabled={submitting}
                style={inputStyle()}
              />
              {analysis?.extracted_source && (
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  <Sparkles size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  Extrait par Claude : <em>{analysis.extracted_source}</em>
                </div>
              )}
            </Field>

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
                <strong style={{ color: "#888" }}>Notes Claude :</strong> {analysis.extraction_notes}
              </div>
            )}
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
            Deal créé, mais Slack a renvoyé : {warnings.join(" · ")}
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
            Annuler
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
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Créer le deal et valider
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
          Cela créera la company, le contact, le deal sur HubSpot
          (pipeline par défaut, stage Discovery) et notifiera le owner sur Slack.
        </div>

        {!error && !loadingAnalysis && analysis?.extracted_email && (
          <div style={{ fontSize: 11, color: ACCENT, textAlign: "center" }}>
            Analyse Claude OK : prospect identifié
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
