"use client";

import React, { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { useGmailStatus } from "@/lib/hooks/use-gmail-status";
import {
  Search, Loader2, Sparkles, X, Upload, Plus, ChevronLeft, ChevronRight,
  Send, Save, RotateCcw, Mail, AlertCircle, Check, FileText, Users,
  Trash2, ArrowLeft, Linkedin,
} from "lucide-react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────

interface Prospect {
  hubspot_id?: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  company?: string;
  industry?: string;
  extraData?: Record<string, unknown>;
}

interface CampaignEmail {
  id: string;
  campaign_id: string;
  hubspot_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  company: string;
  industry: string;
  extra_data: Record<string, unknown>;
  subject: string | null;
  body: string | null;
  status: string;
  error_message: string | null;
  generated_at: string | null;
  sent_at: string | null;
}

interface Campaign {
  id: string;
  name: string | null;
  objective: string;
  status: string;
  qcm_type: string | null;
  qcm_length: string | null;
  qcm_tone: string | null;
  qcm_objectif: string | null;
}

interface HubSpotResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
  linkedinUrl: string | null;
}

// ── Status Badge ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pending:     { label: "En attente",      bg: "#f0f0f0", color: "#888" },
  generating:  { label: "Génération...",   bg: "#f5f3ff", color: "#7c3aed" },
  drafted:     { label: "Brouillon",       bg: "#eff6ff", color: "#2563eb" },
  edited:      { label: "Modifié",         bg: "#eff6ff", color: "#2563eb" },
  sent:        { label: "Envoyé",          bg: "#f0fdf4", color: "#15803d" },
  draft_saved: { label: "Brouillon Gmail", bg: "#fff7ed", color: "#c2410c" },
  error:       { label: "Erreur",          bg: "#fef2f2", color: "#dc2626" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── Pill Select (QCM) ────────────────────────────────────────────────────

function PillSelect({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium" style={{ color: "#888" }}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(value === o.value ? "" : o.value)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: value === o.value ? "#f01563" : "#f5f5f5",
              color: value === o.value ? "#fff" : "#666",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────

function Avatar({ firstName, lastName, size = 32 }: { firstName: string; lastName: string; size?: number }) {
  const initials = ((firstName?.[0] ?? "") + (lastName?.[0] ?? "") || "?").toUpperCase().slice(0, 2);
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, background: "#f01563", color: "#fff", fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── Main Page ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

export default function MassProspectionPage() {
  // ── View state (persisted via URL params) ────────────────────────────
  const [view, setView] = useState<"setup" | "review" | "detail">("setup");
  const [detailEmailId, setDetailEmailId] = useState<string | null>(null);

  // ── Campaign state ───────────────────────────────────────────────────
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [objective, setObjective] = useState("");
  const [qcmType, setQcmType] = useState("");
  const [qcmLength, setQcmLength] = useState("");
  const [qcmTone, setQcmTone] = useState("");
  const [qcmObjectif, setQcmObjectif] = useState("");
  const [campaignStatus, setCampaignStatus] = useState("draft");

  // ── Prospects (local before campaign creation) ───────────────────────
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [emails, setEmails] = useState<CampaignEmail[]>([]);

  // ── Previous campaigns ───────────────────────────────────────────────
  const [prevCampaigns, setPrevCampaigns] = useState<(Campaign & { emailCount: number })[]>([]);
  const [showPrevCampaigns, setShowPrevCampaigns] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [sourceTab, setSourceTab] = useState<"hubspot" | "csv" | "manual">("hubspot");

  // ── HubSpot search ───────────────────────────────────────────────────
  const [hsQuery, setHsQuery] = useState("");
  const [hsResults, setHsResults] = useState<HubSpotResult[]>([]);
  const [hsLoading, setHsLoading] = useState(false);

  // ── CSV modal ────────────────────────────────────────────────────────
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<Record<string, string>[]>([]);
  const [csvTotalRows, setCsvTotalRows] = useState(0);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvParsing, setCsvParsing] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // ── Manual add ───────────────────────────────────────────────────────
  const [manualEmail, setManualEmail] = useState("");
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualJobTitle, setManualJobTitle] = useState("");

  // ── Detail view state ────────────────────────────────────────────────
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [redraftInstructions, setRedraftInstructions] = useState("");
  const [redrafting, setRedrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Gmail status ─────────────────────────────────────────────────────
  const { gmailConnected } = useGmailStatus();

  // ── Restore campaign from localStorage + URL params on mount ─────────
  useEffect(() => {
    const url = new URL(window.location.href);
    const urlView = url.searchParams.get("view");
    const urlEmailId = url.searchParams.get("emailId");
    const urlCampaignId = url.searchParams.get("campaignId");

    const targetCampaignId = urlCampaignId || localStorage.getItem("mass-prospection-active-campaign");

    if (targetCampaignId) {
      // Load campaign, then apply URL view if specified
      (async () => {
        await loadCampaign(targetCampaignId);
        // URL params take priority over loadCampaign's auto-redirect
        if (urlView === "review" || urlView === "detail") setView(urlView);
        if (urlEmailId) {
          setDetailEmailId(urlEmailId);
          // Also load that email's content into editor
          const res = await fetch(`/api/mass-prospection/campaigns/${targetCampaignId}`);
          if (res.ok) {
            const data = await res.json();
            const email = (data.emails as CampaignEmail[]).find((e) => e.id === urlEmailId);
            if (email) {
              setEditSubject(email.subject || "");
              setEditBody(email.body || "");
            }
          }
        }
      })();
    }
    loadPrevCampaigns();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "setup") {
      url.searchParams.delete("view");
      url.searchParams.delete("emailId");
      url.searchParams.delete("campaignId");
    } else if (view === "review") {
      url.searchParams.set("view", "review");
      url.searchParams.delete("emailId");
      if (campaignId) url.searchParams.set("campaignId", campaignId);
    } else if (view === "detail" && detailEmailId) {
      url.searchParams.set("view", "detail");
      url.searchParams.set("emailId", detailEmailId);
      if (campaignId) url.searchParams.set("campaignId", campaignId);
    }
    window.history.replaceState({}, "", url.toString());
  }, [view, detailEmailId, campaignId]);

  // ── Load campaign from Supabase ──────────────────────────────────────
  async function loadCampaign(id: string) {
    try {
      const res = await fetch(`/api/mass-prospection/campaigns/${id}`);
      if (!res.ok) { localStorage.removeItem("mass-prospection-active-campaign"); return; }
      const data = await res.json();
      const c = data.campaign as Campaign;
      setCampaignId(c.id);
      setCampaignName(c.name || "");
      setObjective(c.objective);
      setCampaignStatus(c.status);
      setQcmType(c.qcm_type || "");
      setQcmLength(c.qcm_length || "");
      setQcmTone(c.qcm_tone || "");
      setQcmObjectif(c.qcm_objectif || "");
      setEmails(data.emails);
      localStorage.setItem("mass-prospection-active-campaign", c.id);

      // If campaign has emails, go to review
      if (data.emails.length > 0 && (c.status === "ready" || c.status === "generating" || c.status === "completed")) {
        setView("review");
        if (c.status === "generating") startPolling(c.id);
      }
    } catch { /* ignore */ }
  }

  async function loadPrevCampaigns() {
    try {
      const res = await fetch("/api/mass-prospection/campaigns");
      if (res.ok) {
        const data = await res.json();
        setPrevCampaigns(data.campaigns ?? []);
      }
    } catch { /* ignore */ }
  }

  // ── Polling during generation ────────────────────────────────────────
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling(id: string) {
    setGenerating(true);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/mass-prospection/campaigns/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setEmails(data.emails);
        const done = data.emails.filter((e: CampaignEmail) => !["pending", "generating"].includes(e.status)).length;
        setGenProgress({ done, total: data.emails.length });
        if (data.campaign.status !== "generating") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setGenerating(false);
          setCampaignStatus(data.campaign.status);
        }
      } catch { /* retry on next tick */ }
    }, 3000);
  }

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // ── HubSpot search ───────────────────────────────────────────────────
  async function searchHubSpot() {
    if (!hsQuery.trim()) return;
    setHsLoading(true);
    try {
      const res = await fetch(`/api/prospection/search?q=${encodeURIComponent(hsQuery)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setHsResults(data.results ?? []);
      }
    } catch { /* ignore */ }
    setHsLoading(false);
  }

  function addProspect(p: Prospect) {
    if (prospects.some((x) => x.email.toLowerCase() === p.email.toLowerCase())) return;
    setProspects((prev) => [...prev, p]);
  }

  function removeProspect(email: string) {
    setProspects((prev) => prev.filter((p) => p.email.toLowerCase() !== email.toLowerCase()));
  }

  // ── CSV handling ─────────────────────────────────────────────────────
  async function handleCsvFile(file: File) {
    setCsvParsing(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/mass-prospection/csv-parse", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setCsvHeaders(data.headers);
        setCsvPreview(data.preview);
        setCsvTotalRows(data.totalRows);
        // Auto-detect mapping
        const mapping: Record<string, string> = {};
        for (const h of data.headers) {
          const lower = h.toLowerCase();
          if (lower.includes("email") || lower.includes("mail") || lower.includes("e-mail")) mapping.email = h;
          else if (lower.includes("prenom") || lower.includes("first") || lower.includes("prénom")) mapping.firstName = h;
          else if (lower.includes("nom") || lower.includes("last") || lower === "name") mapping.lastName = h;
          else if (lower.includes("entreprise") || lower.includes("company") || lower.includes("société") || lower.includes("societe") || lower.includes("organization")) mapping.company = h;
          else if (lower.includes("poste") || lower.includes("title") || lower.includes("fonction") || lower.includes("job")) mapping.jobTitle = h;
          else if (lower.includes("industrie") || lower.includes("industry") || lower.includes("secteur")) mapping.industry = h;
        }
        setCsvMapping(mapping);
        setCsvModalOpen(true);
      }
    } catch { /* ignore */ }
    setCsvParsing(false);
  }

  function importCsv() {
    if (!csvMapping.email) return;
    const newProspects: Prospect[] = [];
    // Re-parse all rows from preview (we only have preview, but the full data was parsed server-side)
    // For the real import, we read all rows from the preview response
    // Actually, the preview only has 5 rows. We need all rows. Let's use the full CSV approach:
    // The CSV parse endpoint returns only preview. For the full import, the frontend should read the file directly.
    // But since the file is already uploaded, let's handle it client-side.

    // We stored the full CSV when the modal was opened. Let's use the preview for now
    // and extend this with the full file parsing.
    // For simplicity: we parse client-side using the file already in the input.
    const fileInput = csvFileRef.current;
    if (!fileInput?.files?.[0]) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return;

      function parseLine(line: string): string[] {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
          } else if ((char === "," || char === ";") && !inQuotes) {
            result.push(current.trim());
            current = "";
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      }

      const headers = parseLine(lines[0]);
      const getIdx = (field: string) => {
        const mapped = csvMapping[field];
        return mapped ? headers.indexOf(mapped) : -1;
      };

      const emailIdx = getIdx("email");
      if (emailIdx === -1) return;

      for (let i = 1; i < lines.length; i++) {
        const values = parseLine(lines[i]);
        const email = values[emailIdx]?.trim();
        if (!email || !email.includes("@")) continue;
        newProspects.push({
          firstName: values[getIdx("firstName")]?.trim() || "",
          lastName: values[getIdx("lastName")]?.trim() || "",
          email,
          company: values[getIdx("company")]?.trim() || "",
          jobTitle: values[getIdx("jobTitle")]?.trim() || "",
          industry: values[getIdx("industry")]?.trim() || "",
        });
      }

      // Deduplicate against existing
      const existingEmails = new Set(prospects.map((p) => p.email.toLowerCase()));
      const unique = newProspects.filter((p) => !existingEmails.has(p.email.toLowerCase()));
      setProspects((prev) => [...prev, ...unique]);
      setCsvModalOpen(false);
    };
    reader.readAsText(fileInput.files[0]);
  }

  // ── Manual add ───────────────────────────────────────────────────────
  function handleManualAdd() {
    if (!manualEmail.trim() || !manualEmail.includes("@")) return;
    addProspect({
      firstName: manualFirstName.trim(),
      lastName: manualLastName.trim(),
      email: manualEmail.trim(),
      company: manualCompany.trim(),
      jobTitle: manualJobTitle.trim(),
    });
    setManualEmail("");
    setManualFirstName("");
    setManualLastName("");
    setManualCompany("");
    setManualJobTitle("");
  }

  // ── Generate campaign ────────────────────────────────────────────────
  async function handleGenerate() {
    if (!prospects.length || !objective.trim()) return;
    setGenerating(true);

    try {
      // 1. Create campaign
      const campRes = await fetch("/api/mass-prospection/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName || null,
          objective,
          qcm_type: qcmType || null,
          qcm_length: qcmLength || null,
          qcm_tone: qcmTone || null,
          qcm_objectif: qcmObjectif || null,
        }),
      });
      const campData = await campRes.json();
      const newCampaignId = campData.campaign.id;
      setCampaignId(newCampaignId);
      localStorage.setItem("mass-prospection-active-campaign", newCampaignId);

      // 2. Add prospects
      await fetch(`/api/mass-prospection/campaigns/${newCampaignId}/prospects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospects }),
      });

      // 3. Start generation
      setView("review");
      setGenProgress({ done: 0, total: prospects.length });

      fetch(`/api/mass-prospection/campaigns/${newCampaignId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});

      // 4. Start polling
      startPolling(newCampaignId);
    } catch {
      setGenerating(false);
    }
  }

  // ── Regenerate errors ────────────────────────────────────────────────
  async function handleRegenerateErrors() {
    if (!campaignId) return;
    setGenerating(true);
    fetch(`/api/mass-prospection/campaigns/${campaignId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyErrors: true }),
    }).catch(() => {});
    startPolling(campaignId);
  }

  // ── Bulk send / draft ────────────────────────────────────────────────
  async function handleBulkAction(action: "send" | "draft") {
    if (!campaignId) return;
    const eligible = emails.filter((e) => ["drafted", "edited"].includes(e.status));
    for (const email of eligible) {
      try {
        await fetch(`/api/mass-prospection/campaigns/${campaignId}/send/${email.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        setEmails((prev) =>
          prev.map((e) => e.id === email.id ? { ...e, status: action === "send" ? "sent" : "draft_saved" } : e)
        );
      } catch { /* continue with rest */ }
    }
  }

  // ── Detail view helpers ──────────────────────────────────────────────
  const currentEmail = emails.find((e) => e.id === detailEmailId);
  const currentIndex = emails.findIndex((e) => e.id === detailEmailId);

  function openDetail(emailId: string) {
    const email = emails.find((e) => e.id === emailId);
    if (email) {
      setEditSubject(email.subject || "");
      setEditBody(email.body || "");
      setRedraftInstructions("");
      setDetailEmailId(emailId);
      setView("detail");
    }
  }

  // Auto-save with debounce
  const autoSave = useCallback((subject: string, body: string) => {
    if (!campaignId || !detailEmailId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await fetch(`/api/mass-prospection/campaigns/${campaignId}/prospects/${detailEmailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      setEmails((prev) =>
        prev.map((e) => e.id === detailEmailId ? { ...e, subject, body, status: "edited" } : e)
      );
    }, 1500);
  }, [campaignId, detailEmailId]);

  function handleSubjectChange(v: string) {
    setEditSubject(v);
    autoSave(v, editBody);
  }

  function handleBodyChange(v: string) {
    setEditBody(v);
    autoSave(editSubject, v);
  }

  async function handleRedraft() {
    if (!campaignId || !detailEmailId) return;
    setRedrafting(true);
    try {
      const res = await fetch(`/api/mass-prospection/campaigns/${campaignId}/regenerate/${detailEmailId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: redraftInstructions }),
      });
      if (res.ok) {
        const data = await res.json();
        setEditSubject(data.subject);
        setEditBody(data.body);
        setEmails((prev) =>
          prev.map((e) => e.id === detailEmailId ? { ...e, subject: data.subject, body: data.body, status: "drafted" } : e)
        );
        setRedraftInstructions("");
      }
    } catch { /* ignore */ }
    setRedrafting(false);
  }

  async function handleSendOrDraft(action: "send" | "draft") {
    if (!campaignId || !detailEmailId) return;
    setSending(true);
    try {
      // Save current edits first
      await fetch(`/api/mass-prospection/campaigns/${campaignId}/prospects/${detailEmailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: editSubject, body: editBody }),
      });
      const res = await fetch(`/api/mass-prospection/campaigns/${campaignId}/send/${detailEmailId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const newStatus = action === "send" ? "sent" : "draft_saved";
        setEmails((prev) =>
          prev.map((e) => e.id === detailEmailId ? { ...e, status: newStatus, subject: editSubject, body: editBody } : e)
        );
      }
    } catch { /* ignore */ }
    setSending(false);
  }

  function navigateDetail(dir: -1 | 1) {
    const nextIndex = currentIndex + dir;
    if (nextIndex >= 0 && nextIndex < emails.length) {
      openDetail(emails[nextIndex].id);
    }
  }

  // ── New campaign ─────────────────────────────────────────────────────
  function handleNewCampaign() {
    setCampaignId(null);
    setCampaignName("");
    setObjective("");
    setQcmType("");
    setQcmLength("");
    setQcmTone("");
    setQcmObjectif("");
    setCampaignStatus("draft");
    setProspects([]);
    setEmails([]);
    setView("setup");
    localStorage.removeItem("mass-prospection-active-campaign");
  }

  // ── Stats ────────────────────────────────────────────────────────────
  const stats = {
    total: emails.length,
    drafted: emails.filter((e) => ["drafted", "edited"].includes(e.status)).length,
    sent: emails.filter((e) => e.status === "sent").length,
    draftSaved: emails.filter((e) => e.status === "draft_saved").length,
    errors: emails.filter((e) => e.status === "error").length,
  };

  // ════════════════════════════════════════════════════════════════════
  // ── RENDER ──────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#fafafa" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#eee", background: "#fff" }}>
        <div className="flex items-center gap-3">
          {view !== "setup" && (
            <button
              onClick={() => view === "detail" ? setView("review") : handleNewCampaign()}
              className="p-1.5 rounded-lg transition-colors hover:bg-gray-100"
            >
              <ArrowLeft size={16} style={{ color: "#666" }} />
            </button>
          )}
          <h1 className="text-base font-semibold" style={{ color: "#111" }}>
            {view === "setup" ? "Prospection Mass" : view === "review" ? (campaignName || "Campagne") : "Édition email"}
          </h1>
          {view === "review" && generating && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "#7c3aed" }}>
              <Loader2 size={14} className="animate-spin" />
              Génération en cours... {genProgress.done}/{genProgress.total}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(view === "setup" || view === "review") && prevCampaigns.length > 0 && (
            <button
              onClick={() => setShowPrevCampaigns(!showPrevCampaigns)}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: "#e5e5e5", color: "#666" }}
            >
              Campagnes précédentes
            </button>
          )}
          {(view === "review" || view === "detail") && (
            <button
              onClick={handleNewCampaign}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ background: "#f5f5f5", color: "#666" }}
            >
              Nouvelle campagne
            </button>
          )}
        </div>
      </div>

      {/* Gmail warning */}
      {!gmailConnected && (
        <div className="flex items-center gap-2 px-6 py-2 text-xs" style={{ background: "#fff7ed", color: "#c2410c" }}>
          <AlertCircle size={14} />
          Gmail non connecté — <Link href="/settings" className="underline">Connecter dans les paramètres</Link>
        </div>
      )}

      {/* Previous campaigns dropdown */}
      {showPrevCampaigns && (
        <div className="border-b px-6 py-3" style={{ borderColor: "#eee", background: "#fff" }}>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {prevCampaigns.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors hover:bg-gray-50"
              >
                <button
                  onClick={() => { loadCampaign(c.id); setShowPrevCampaigns(false); }}
                  className="flex-1 flex items-center gap-2 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium" style={{ color: "#111" }}>{c.name || "Sans nom"}</span>
                    <span className="text-[10px] ml-2" style={{ color: "#888" }}>{c.emailCount} contacts</span>
                  </div>
                  <StatusBadge status={c.status} />
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const res = await fetch(`/api/mass-prospection/campaigns/${c.id}`, { method: "DELETE" });
                    if (res.ok) {
                      setPrevCampaigns((prev) => prev.filter((p) => p.id !== c.id));
                      if (campaignId === c.id) handleNewCampaign();
                    }
                  }}
                  className="ml-2 p-1.5 rounded-lg transition-colors hover:bg-red-50 shrink-0"
                  title="Supprimer la campagne"
                >
                  <Trash2 size={13} style={{ color: "#dc2626" }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETUP VIEW ──────────────────────────────────────────────── */}
      {view === "setup" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Prospect Selection */}
          <div className="w-1/2 flex flex-col border-r overflow-hidden" style={{ borderColor: "#eee" }}>
            {/* Source tabs */}
            <div className="flex items-center gap-1 px-4 py-3 border-b" style={{ borderColor: "#eee", background: "#fff" }}>
              {(["hubspot", "csv", "manual"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSourceTab(tab)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: sourceTab === tab ? "#f01563" : "transparent",
                    color: sourceTab === tab ? "#fff" : "#666",
                  }}
                >
                  {tab === "hubspot" ? "HubSpot" : tab === "csv" ? "CSV" : "Manuel"}
                </button>
              ))}
            </div>

            {/* Source content */}
            <div className="flex-1 overflow-y-auto" style={{ background: "#fff" }}>
              {/* HubSpot tab */}
              {sourceTab === "hubspot" && (
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={hsQuery}
                        onChange={(e) => setHsQuery(e.target.value)}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && searchHubSpot()}
                        placeholder="Rechercher des contacts HubSpot..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border text-xs outline-none transition-all"
                        style={{ borderColor: "#e5e5e5" }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
                      />
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#aaa" }} />
                    </div>
                    <button
                      onClick={searchHubSpot}
                      disabled={hsLoading}
                      className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: "#f01563", color: "#fff", opacity: hsLoading ? 0.6 : 1 }}
                    >
                      {hsLoading ? <Loader2 size={14} className="animate-spin" /> : "Rechercher"}
                    </button>
                  </div>
                  {hsResults.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {hsResults.map((r) => {
                        const added = prospects.some((p) => p.email.toLowerCase() === r.email?.toLowerCase());
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-2.5 p-2.5 rounded-lg border transition-all"
                            style={{ borderColor: added ? "#f01563" : "#f0f0f0", background: added ? "#fff8fb" : "#fff" }}
                          >
                            <Avatar firstName={r.firstName} lastName={r.lastName} size={28} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium truncate" style={{ color: "#111" }}>{r.firstName} {r.lastName}</span>
                                {r.linkedinUrl && (
                                  <a href={r.linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#0a66c2" }}>
                                    <Linkedin size={10} />
                                  </a>
                                )}
                              </div>
                              <span className="text-[10px] truncate block" style={{ color: "#888" }}>
                                {r.jobTitle ? `${r.jobTitle} · ` : ""}{r.company || r.email}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                if (!added && r.email) {
                                  addProspect({
                                    hubspot_id: r.id,
                                    firstName: r.firstName,
                                    lastName: r.lastName,
                                    email: r.email,
                                    jobTitle: r.jobTitle,
                                    company: r.company,
                                    industry: r.industry,
                                    extraData: { lifecyclestage: r.lifecyclestage, linkedinUrl: r.linkedinUrl },
                                  });
                                }
                              }}
                              disabled={added || !r.email}
                              className="p-1.5 rounded-lg transition-all shrink-0"
                              style={{
                                background: added ? "#f0fdf4" : "#f5f5f5",
                                color: added ? "#15803d" : "#666",
                                opacity: !r.email ? 0.3 : 1,
                              }}
                            >
                              {added ? <Check size={14} /> : <Plus size={14} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* CSV tab */}
              {sourceTab === "csv" && (
                <div className="p-4 flex flex-col gap-3 items-center justify-center min-h-[200px]">
                  <input
                    ref={csvFileRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvFile(file);
                    }}
                  />
                  <div
                    className="w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all"
                    style={{ borderColor: "#e5e5e5" }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#f01563"; }}
                    onDragLeave={(e) => { e.currentTarget.style.borderColor = "#e5e5e5"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = "#e5e5e5";
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.name.endsWith(".csv")) handleCsvFile(file);
                    }}
                    onClick={() => csvFileRef.current?.click()}
                  >
                    {csvParsing ? (
                      <Loader2 size={24} className="animate-spin" style={{ color: "#f01563" }} />
                    ) : (
                      <>
                        <Upload size={24} style={{ color: "#ccc" }} />
                        <span className="text-xs" style={{ color: "#888" }}>
                          Glissez un fichier CSV ici ou <span style={{ color: "#f01563" }}>cliquez pour parcourir</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Manual tab */}
              {sourceTab === "manual" && (
                <div className="p-4 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium" style={{ color: "#888" }}>Prénom</span>
                      <input
                        value={manualFirstName}
                        onChange={(e) => setManualFirstName(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none"
                        style={{ borderColor: "#e5e5e5" }}
                        placeholder="Jean"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium" style={{ color: "#888" }}>Nom</span>
                      <input
                        value={manualLastName}
                        onChange={(e) => setManualLastName(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none"
                        style={{ borderColor: "#e5e5e5" }}
                        placeholder="Dupont"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium" style={{ color: "#888" }}>Email *</span>
                    <input
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleManualAdd()}
                      className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none"
                      style={{ borderColor: "#e5e5e5" }}
                      placeholder="jean@entreprise.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium" style={{ color: "#888" }}>Entreprise</span>
                      <input
                        value={manualCompany}
                        onChange={(e) => setManualCompany(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none"
                        style={{ borderColor: "#e5e5e5" }}
                        placeholder="Acme Corp"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium" style={{ color: "#888" }}>Poste</span>
                      <input
                        value={manualJobTitle}
                        onChange={(e) => setManualJobTitle(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none"
                        style={{ borderColor: "#e5e5e5" }}
                        placeholder="DRH"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleManualAdd}
                    disabled={!manualEmail.includes("@")}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: manualEmail.includes("@") ? "#f01563" : "#f5f5f5",
                      color: manualEmail.includes("@") ? "#fff" : "#aaa",
                    }}
                  >
                    <Plus size={14} /> Ajouter
                  </button>
                </div>
              )}
            </div>

            {/* Selected prospects (always visible) */}
            <div className="border-t" style={{ borderColor: "#eee", background: "#fafafa" }}>
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Users size={14} style={{ color: "#f01563" }} />
                  <span className="text-xs font-semibold" style={{ color: "#111" }}>
                    {prospects.length} prospect{prospects.length !== 1 ? "s" : ""} sélectionné{prospects.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {prospects.length > 0 && (
                  <button onClick={() => setProspects([])} className="text-[10px]" style={{ color: "#dc2626" }}>
                    Tout supprimer
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto px-4 pb-3 flex flex-col gap-1">
                {prospects.map((p) => (
                  <div
                    key={p.email}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                    style={{ background: "#fff", border: "1px solid #f0f0f0" }}
                  >
                    <Avatar firstName={p.firstName} lastName={p.lastName} size={22} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium truncate block" style={{ color: "#111" }}>
                        {p.firstName || p.lastName ? `${p.firstName} ${p.lastName}`.trim() : p.email}
                      </span>
                      {(p.firstName || p.lastName) && (
                        <span className="text-[9px] truncate block" style={{ color: "#888" }}>{p.email}</span>
                      )}
                    </div>
                    <button onClick={() => removeProspect(p.email)} className="p-0.5 rounded hover:bg-gray-100">
                      <X size={12} style={{ color: "#aaa" }} />
                    </button>
                  </div>
                ))}
                {prospects.length === 0 && (
                  <span className="text-[11px] text-center py-4" style={{ color: "#ccc" }}>
                    Ajoutez des prospects via HubSpot, CSV ou manuellement
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Campaign Config */}
          <div className="w-1/2 flex flex-col overflow-y-auto p-6 gap-5" style={{ background: "#fff" }}>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "#888" }}>Nom de la campagne</span>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-xs outline-none transition-all"
                style={{ borderColor: "#e5e5e5" }}
                placeholder="Ex: Campagne DRH Tech Q2"
                onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "#888" }}>Objectif de la campagne *</span>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={5}
                className="w-full rounded-lg border px-3 py-2 text-xs outline-none resize-none transition-all"
                style={{ borderColor: "#e5e5e5" }}
                placeholder="Décrivez le but de cette campagne de prospection, le message clé, le contexte..."
                onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
              />
            </div>

            <div className="flex flex-col gap-4">
              <span className="text-xs font-semibold" style={{ color: "#111" }}>Paramètres de rédaction</span>
              <PillSelect
                label="Type"
                value={qcmType}
                onChange={setQcmType}
                options={[
                  { value: "intro", label: "Premier contact" },
                  { value: "followup", label: "Follow-up" },
                ]}
              />
              <PillSelect
                label="Longueur"
                value={qcmLength}
                onChange={setQcmLength}
                options={[
                  { value: "court", label: "Court" },
                  { value: "moyen", label: "Moyen" },
                  { value: "long", label: "Long" },
                ]}
              />
              <PillSelect
                label="Ton"
                value={qcmTone}
                onChange={setQcmTone}
                options={[
                  { value: "formel", label: "Formel" },
                  { value: "semi-formel", label: "Semi-formel" },
                  { value: "direct", label: "Direct" },
                  { value: "challenger", label: "Challenger" },
                ]}
              />
              <PillSelect
                label="Objectif"
                value={qcmObjectif}
                onChange={setQcmObjectif}
                options={[
                  { value: "rdv", label: "Obtenir un RDV" },
                  { value: "ressource", label: "Partager une ressource" },
                  { value: "qualifier", label: "Qualifier le besoin" },
                  { value: "reactiver", label: "Réactiver la relation" },
                ]}
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={!prospects.length || !objective.trim() || generating}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all mt-2"
              style={{
                background: prospects.length && objective.trim() && !generating ? "#f01563" : "#f5f5f5",
                color: prospects.length && objective.trim() && !generating ? "#fff" : "#aaa",
              }}
            >
              {generating ? (
                <><Loader2 size={16} className="animate-spin" /> Génération en cours...</>
              ) : (
                <><Sparkles size={16} /> Générer {prospects.length} email{prospects.length !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── REVIEW VIEW ─────────────────────────────────────────────── */}
      {view === "review" && (
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#fff" }}>
          {/* Stats bar */}
          <div className="flex items-center gap-4 px-6 py-3 border-b" style={{ borderColor: "#eee" }}>
            <span className="text-xs" style={{ color: "#888" }}>
              <strong style={{ color: "#111" }}>{stats.total}</strong> contacts
            </span>
            {stats.drafted > 0 && (
              <span className="text-xs" style={{ color: "#2563eb" }}>{stats.drafted} brouillons</span>
            )}
            {stats.sent > 0 && (
              <span className="text-xs" style={{ color: "#15803d" }}>{stats.sent} envoyés</span>
            )}
            {stats.draftSaved > 0 && (
              <span className="text-xs" style={{ color: "#c2410c" }}>{stats.draftSaved} brouillons Gmail</span>
            )}
            {stats.errors > 0 && (
              <span className="text-xs" style={{ color: "#dc2626" }}>{stats.errors} erreurs</span>
            )}
            <div className="flex-1" />
            {stats.errors > 0 && (
              <button
                onClick={handleRegenerateErrors}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "#fef2f2", color: "#dc2626" }}
              >
                <RotateCcw size={12} /> Régénérer erreurs
              </button>
            )}
            {stats.drafted > 0 && gmailConnected && (
              <>
                <button
                  onClick={() => handleBulkAction("draft")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "#fff7ed", color: "#c2410c" }}
                >
                  <Save size={12} /> Tous en brouillon Gmail
                </button>
                <button
                  onClick={() => handleBulkAction("send")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "#f01563", color: "#fff" }}
                >
                  <Send size={12} /> Envoyer tous
                </button>
              </>
            )}
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto">
            {emails.map((email) => (
              <div
                key={email.id}
                onClick={() => email.status !== "pending" && email.status !== "generating" && openDetail(email.id)}
                className="flex items-center gap-3 px-6 py-3 border-b transition-all"
                style={{
                  borderColor: "#f5f5f5",
                  cursor: ["pending", "generating"].includes(email.status) ? "default" : "pointer",
                }}
                onMouseEnter={(e) => { if (!["pending", "generating"].includes(email.status)) e.currentTarget.style.background = "#fafafa"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Avatar firstName={email.first_name} lastName={email.last_name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate" style={{ color: "#111" }}>
                      {email.first_name} {email.last_name}
                    </span>
                    {email.company && (
                      <span className="text-[10px] truncate" style={{ color: "#888" }}>{email.company}</span>
                    )}
                  </div>
                  <span className="text-[10px] truncate block" style={{ color: "#aaa" }}>
                    {email.subject || email.email}
                  </span>
                </div>
                <StatusBadge status={email.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DETAIL VIEW ─────────────────────────────────────────────── */}
      {view === "detail" && currentEmail && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Email editor */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#fff" }}>
            {/* To field */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b" style={{ borderColor: "#f0f0f0" }}>
              <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>À</span>
              <span className="text-xs" style={{ color: "#111" }}>{currentEmail.email}</span>
            </div>

            {/* Subject */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b" style={{ borderColor: "#f0f0f0" }}>
              <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>Objet</span>
              <input
                value={editSubject}
                onChange={(e) => handleSubjectChange(e.target.value)}
                className="flex-1 text-xs outline-none bg-transparent"
                style={{ color: "#111" }}
                placeholder="Objet de l'email..."
              />
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
              <textarea
                value={editBody}
                onChange={(e) => handleBodyChange(e.target.value)}
                className="w-full h-full px-5 py-4 text-xs outline-none resize-none"
                style={{ color: "#111", lineHeight: "1.7" }}
                placeholder="Corps de l'email..."
              />
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-3 border-t" style={{ borderColor: "#f0f0f0" }}>
              <button
                onClick={() => handleSendOrDraft("send")}
                disabled={!gmailConnected || sending || currentEmail.status === "sent"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: gmailConnected && !sending && currentEmail.status !== "sent" ? "#f01563" : "#f5f5f5",
                  color: gmailConnected && !sending && currentEmail.status !== "sent" ? "#fff" : "#aaa",
                }}
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {currentEmail.status === "sent" ? "Envoyé" : "Envoyer"}
              </button>
              <button
                onClick={() => handleSendOrDraft("draft")}
                disabled={!gmailConnected || sending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "#fff7ed",
                  color: gmailConnected && !sending ? "#c2410c" : "#aaa",
                }}
              >
                <Save size={14} /> Brouillon Gmail
              </button>
              <div className="flex-1" />
              {/* Nav arrows */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigateDetail(-1)}
                  disabled={currentIndex <= 0}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ background: "#f5f5f5", opacity: currentIndex <= 0 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={14} style={{ color: "#666" }} />
                </button>
                <span className="text-[10px] px-1" style={{ color: "#888" }}>
                  {currentIndex + 1}/{emails.length}
                </span>
                <button
                  onClick={() => navigateDetail(1)}
                  disabled={currentIndex >= emails.length - 1}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ background: "#f5f5f5", opacity: currentIndex >= emails.length - 1 ? 0.3 : 1 }}
                >
                  <ChevronRight size={14} style={{ color: "#666" }} />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Prospect context + Redraft */}
          <div className="w-80 flex flex-col border-l overflow-y-auto" style={{ borderColor: "#eee", background: "#fafafa" }}>
            {/* Prospect card */}
            <div className="p-4 border-b" style={{ borderColor: "#eee" }}>
              <div className="flex items-center gap-2.5 mb-3">
                <Avatar firstName={currentEmail.first_name} lastName={currentEmail.last_name} size={36} />
                <div>
                  <span className="text-xs font-semibold block" style={{ color: "#111" }}>
                    {currentEmail.first_name} {currentEmail.last_name}
                  </span>
                  <span className="text-[10px] block" style={{ color: "#888" }}>{currentEmail.email}</span>
                </div>
              </div>
              {currentEmail.job_title && (
                <div className="text-[11px] mb-1" style={{ color: "#666" }}>
                  <strong>Poste :</strong> {currentEmail.job_title}
                </div>
              )}
              {currentEmail.company && (
                <div className="text-[11px] mb-1" style={{ color: "#666" }}>
                  <strong>Entreprise :</strong> {currentEmail.company}
                </div>
              )}
              {currentEmail.industry && (
                <div className="text-[11px] mb-1" style={{ color: "#666" }}>
                  <strong>Secteur :</strong> {currentEmail.industry}
                </div>
              )}
              <StatusBadge status={currentEmail.status} />
            </div>

            {/* Redraft section */}
            <div className="p-4 flex flex-col gap-3">
              <span className="text-xs font-semibold" style={{ color: "#111" }}>
                <Sparkles size={12} className="inline mr-1" style={{ color: "#f01563" }} />
                Demander à Claude de re-rédiger
              </span>
              <textarea
                value={redraftInstructions}
                onChange={(e) => setRedraftInstructions(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-xs outline-none resize-none transition-all"
                style={{ borderColor: "#e5e5e5" }}
                placeholder="Ex: Rends le plus court, ajoute une référence à leur récente levée de fonds..."
                onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
              />
              <button
                onClick={handleRedraft}
                disabled={redrafting}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: "#f01563", color: "#fff", opacity: redrafting ? 0.6 : 1 }}
              >
                {redrafting ? (
                  <><Loader2 size={14} className="animate-spin" /> Re-génération...</>
                ) : (
                  <><RotateCcw size={14} /> Re-générer</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV MODAL ───────────────────────────────────────────────── */}
      {csvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-lg rounded-2xl shadow-xl" style={{ background: "#fff" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#eee" }}>
              <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Mapper les colonnes CSV</h3>
              <button onClick={() => setCsvModalOpen(false)} className="p-1 rounded-lg hover:bg-gray-100">
                <X size={16} style={{ color: "#666" }} />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <p className="text-xs" style={{ color: "#888" }}>
                {csvTotalRows} ligne{csvTotalRows !== 1 ? "s" : ""} détectée{csvTotalRows !== 1 ? "s" : ""}. Associez chaque champ au bon en-tête CSV.
              </p>

              {/* Mapping selects */}
              {[
                { key: "email", label: "Email *", required: true },
                { key: "firstName", label: "Prénom", required: false },
                { key: "lastName", label: "Nom", required: false },
                { key: "company", label: "Entreprise", required: false },
                { key: "jobTitle", label: "Poste", required: false },
                { key: "industry", label: "Secteur", required: false },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-24 shrink-0" style={{ color: "#111" }}>{label}</span>
                  <select
                    value={csvMapping[key] || ""}
                    onChange={(e) => setCsvMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
                    style={{ borderColor: "#e5e5e5" }}
                  >
                    <option value="">— Ignorer —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* Preview */}
              {csvPreview.length > 0 && csvMapping.email && (
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: "#e5e5e5" }}>
                  <div className="text-[10px] font-medium px-3 py-1.5" style={{ background: "#fafafa", color: "#888" }}>
                    Aperçu (3 premières lignes)
                  </div>
                  {csvPreview.slice(0, 3).map((row, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-t text-[10px]" style={{ borderColor: "#f0f0f0" }}>
                      <span style={{ color: "#111" }}>
                        {csvMapping.firstName ? row[csvMapping.firstName] : ""}{" "}
                        {csvMapping.lastName ? row[csvMapping.lastName] : ""}
                      </span>
                      <span style={{ color: "#888" }}>— {row[csvMapping.email]}</span>
                      {csvMapping.company && <span style={{ color: "#aaa" }}>({row[csvMapping.company]})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "#eee" }}>
              <button
                onClick={() => setCsvModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium"
                style={{ background: "#f5f5f5", color: "#666" }}
              >
                Annuler
              </button>
              <button
                onClick={importCsv}
                disabled={!csvMapping.email}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: csvMapping.email ? "#f01563" : "#f5f5f5",
                  color: csvMapping.email ? "#fff" : "#aaa",
                }}
              >
                Importer {csvTotalRows} contacts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
