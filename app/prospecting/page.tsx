"use client";

import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useGmailStatus } from "@/lib/hooks/use-gmail-status";
import { useOutreachCounts } from "@/lib/hooks/use-outreach-counts";
import { ExchangesBadge } from "@/components/ui/exchanges-badge";
import { useUser } from "@clerk/nextjs";
import { Paperclip, Send, Save, X, Search, Loader2, Sparkles, RotateCcw, ChevronDown, ChevronRight, ChevronUp, Linkedin, Copy, Check, Mail, MailOpen, Phone, Calendar, MessageSquare } from "lucide-react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
  city: string;
  country: string;
  lastContacted: string;
  leadStatus: string;
  employees: string;
  source: string;
  linkedinUrl: string | null;
  createdAt: string;
}

interface ContactDetails extends SearchResult {
  leadStatus: string;
  crmSummary: string;
  crmDetails: { type: string; date: string; body: string }[];
}

// ── CRM body toggle (for long emails) ─────────────────────────────────────
function CrmBodyToggle({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {expanded ? body : body.slice(0, 280) + "…"}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-0.5 mt-1.5 text-[11px] font-medium"
        style={{ color: "#f01563" }}
      >
        {expanded ? (<>Réduire <ChevronUp size={12} /></>) : (<>Voir plus <ChevronDown size={12} /></>)}
      </button>
    </>
  );
}

// ── Lifecycle helpers ──────────────────────────────────────────────────────

const LIFECYCLE_LABELS: Record<string, string> = {
  subscriber: "Abonné",
  lead: "Lead",
  marketingqualifiedlead: "MQL",
  salesqualifiedlead: "SQL",
  opportunity: "Opportunité",
  customer: "Client",
  evangelist: "Évangéliste",
  other: "Autre",
};

const LIFECYCLE_COLORS: Record<string, { bg: string; text: string }> = {
  subscriber:             { bg: "#f0f0f0", text: "#888" },
  lead:                   { bg: "#eff6ff", text: "#2563eb" },
  marketingqualifiedlead: { bg: "#f5f3ff", text: "#7c3aed" },
  salesqualifiedlead:     { bg: "#fff7ed", text: "#c2410c" },
  opportunity:            { bg: "#fefce8", text: "#b45309" },
  customer:               { bg: "#f0fdf4", text: "#15803d" },
};

const CRM_TYPE_CONFIG: Record<string, { icon: typeof Mail; label: string; color: string; bg: string }> = {
  EMAIL:          { icon: Mail,          label: "Email envoyé", color: "#2563eb", bg: "#eff6ff" },
  INCOMING_EMAIL: { icon: MailOpen,      label: "Email reçu",   color: "#059669", bg: "#ecfdf5" },
  CALL:           { icon: Phone,         label: "Appel",        color: "#d97706", bg: "#fffbeb" },
  MEETING:        { icon: Calendar,      label: "Réunion",      color: "#7c3aed", bg: "#f5f3ff" },
  NOTE:           { icon: MessageSquare, label: "Note",         color: "#6b7280", bg: "#f3f4f6" },
};
const CRM_TYPE_FALLBACK = { icon: MessageSquare, label: "Activité", color: "#6b7280", bg: "#f3f4f6" };

function LifecycleBadge({ stage }: { stage: string }) {
  if (!stage) return null;
  const label = LIFECYCLE_LABELS[stage] ?? stage;
  const color = LIFECYCLE_COLORS[stage] ?? { bg: "#f0f0f0", text: "#888" };
  return (
    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{ background: color.bg, color: color.text }}>
      {label}
    </span>
  );
}

// ── TagInput ───────────────────────────────────────────────────────────────

function TagInput({
  label,
  tags,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");

  const commit = () => {
    const trimmed = value.trim().replace(/,$/, "");
    if (trimmed) { onAdd(trimmed); setValue(""); }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    if (e.key === "Backspace" && !value && tags.length) onRemove(tags[tags.length - 1]);
  };

  return (
    <div className="flex items-start gap-2 px-4 py-2.5 border-b" style={{ borderColor: "#f0f0f0" }}>
      <span className="text-xs font-medium w-10 mt-1.5 shrink-0" style={{ color: "#aaa" }}>{label}</span>
      <div className="flex-1 flex flex-wrap gap-1.5 items-center min-h-[24px]">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ background: "#fde8ef", color: "#f01563" }}
          >
            {tag}
            <button onClick={() => onRemove(tag)} className="hover:opacity-70 flex items-center">
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          onBlur={commit}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 text-sm outline-none bg-transparent min-w-[140px]"
          style={{ color: "#111" }}
        />
      </div>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  readonly = false,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  readonly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium" style={{ color: "#888" }}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-xs outline-none resize-none transition-all"
          style={{
            borderColor: "#e5e5e5",
            color: "#111",
            background: readonly ? "#f9f9f9" : "#fff",
          }}
          onFocus={(e) => { if (!readonly) e.currentTarget.style.borderColor = "#f01563"; }}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
          className="w-full rounded-lg border px-3 py-2 text-xs outline-none transition-all"
          style={{
            borderColor: "#e5e5e5",
            color: "#111",
            background: readonly ? "#f9f9f9" : "#fff",
          }}
          onFocus={(e) => { if (!readonly) e.currentTarget.style.borderColor = "#f01563"; }}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
        />
      )}
    </div>
  );
}

// ── FilterSelect ───────────────────────────────────────────────────────────

function FilterSelect({ value, onChange, label, children }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  const active = !!value;
  return (
    <div className="relative flex-1" style={{ minWidth: "120px", maxWidth: "180px" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full pl-3 pr-7 py-1.5 rounded-lg border text-xs outline-none transition-all cursor-pointer"
        style={{
          borderColor: active ? "#f01563" : "#e5e5e5",
          color: active ? "#f01563" : "#888",
          background: active ? "#fff0f5" : "#fff",
        }}
      >
        <option value="">{label}</option>
        {children}
      </select>
      <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#aaa" }} />
    </div>
  );
}

// ── ProspectCard ───────────────────────────────────────────────────────────

function ProspectCard({ result: r, onSelect, exchanges }: { result: SearchResult; onSelect: () => void; exchanges: number }) {
  const [msgState, setMsgState] = useState<"idle" | "loading" | "done">("idle");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  async function generateMsg(e: React.MouseEvent) {
    e.stopPropagation();
    setMsgState("loading");
    try {
      const res = await fetch("/api/linkedin/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${r.firstName} ${r.lastName}`, jobTitle: r.jobTitle, company: r.company, industry: r.industry, lifecyclestage: r.lifecyclestage }),
      });
      const data = await res.json();
      setMsg(data.message ?? "");
      setMsgState("done");
    } catch { setMsgState("idle"); }
  }

  async function copyMsg(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded-xl border text-left transition-all cursor-pointer"
      style={{ borderColor: "#e5e5e5", background: "#fff" }}
      onClick={onSelect}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#f01563"; e.currentTarget.style.background = "#fff8fb"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e5e5"; e.currentTarget.style.background = "#fff"; }}
    >
      {/* Avatar + name */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "#f01563", color: "#fff" }}>
          {((r.firstName?.[0] ?? "") + (r.lastName?.[0] ?? "") || "?").toUpperCase().slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold truncate leading-tight" style={{ color: "#111" }}>{r.firstName} {r.lastName}</p>
            {r.linkedinUrl && (
              <a href={r.linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#0a66c2", flexShrink: 0 }}>
                <Linkedin size={11} />
              </a>
            )}
          </div>
          {r.jobTitle && <p className="text-[10px] truncate leading-tight" style={{ color: "#888" }}>{r.jobTitle}</p>}
        </div>
      </div>

      {r.company && (
        <p className="text-[11px] font-medium truncate" style={{ color: "#555" }}>
          {r.company}{r.city ? <span style={{ color: "#bbb" }}> · {r.city}</span> : null}
        </p>
      )}
      {r.email && <p className="text-[10px] truncate" style={{ color: "#aaa" }}>{r.email}</p>}

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {r.lifecyclestage && <LifecycleBadge stage={r.lifecyclestage} />}
          {r.industry && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#f5f5f5", color: "#999" }}>{r.industry}</span>}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {exchanges > 0 && <ExchangesBadge count={exchanges} />}
          {r.lastContacted && (
            <span className="text-[9px]" style={{ color: "#bbb" }}>Dernier contact : {new Date(r.lastContacted).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</span>
          )}
          {r.createdAt && (
            <span className="text-[9px]" style={{ color: "#bbb" }}>Créé le : {new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</span>
          )}
        </div>
      </div>

      {/* LinkedIn message */}
      {r.linkedinUrl && msgState !== "done" && (
        <button
          onClick={generateMsg}
          disabled={msgState === "loading"}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border"
          style={{ borderColor: "#e5e5e5", color: "#374151", background: "white", cursor: "pointer" }}
        >
          {msgState === "loading" ? <><Loader2 size={9} className="animate-spin" /> Génération…</> : <><Linkedin size={9} /> Message LinkedIn</>}
        </button>
      )}
      {msgState === "done" && msg && (
        <div className="relative p-2 rounded-lg text-[10px] leading-relaxed" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#374151", paddingRight: 20 }} onClick={(e) => e.stopPropagation()}>
          {msg}
          <button onClick={copyMsg} className="absolute top-1.5 right-1.5" style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#16a34a" : "#9ca3af" }}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function ProspectingPage() {
  const { user } = useUser();

  // Gmail (SWR-cached)
  const { gmailConnected } = useGmailStatus();

  // Composer state
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Agent state
  const [agentStep, setAgentStep] = useState<1 | 2 | 3>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [simpleQuery, setSimpleQuery] = useState("");
  const [filterLifecycle, setFilterLifecycle] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterLeadStatus, setFilterLeadStatus] = useState("");
  const [filterContacted, setFilterContacted] = useState("");
  const [filterCompanySize, setFilterCompanySize] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterCreatedYear, setFilterCreatedYear] = useState("");
  const [filterSort, setFilterSort] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const searchEmails = React.useMemo(() => searchResults.map((r) => r.email).filter(Boolean), [searchResults]);
  const searchHubspotIds = React.useMemo(() => searchResults.map((r) => r.id).filter(Boolean), [searchResults]);
  const { countByEmail, countByHubspotId } = useOutreachCounts(searchEmails, searchHubspotIds);

  const [selectedContact, setSelectedContact] = useState<ContactDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Manual fields
  const [contactIndustry, setContactIndustry] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [recentNews, setRecentNews] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [coachingNeed, setCoachingNeed] = useState("");
  const [angle, setAngle] = useState("");
  const [userInstructions, setUserInstructions] = useState("");

  // QCM targeting
  const [qcmType, setQcmType] = useState<"intro" | "followup" | "">("");
  const [qcmLength, setQcmLength] = useState<"court" | "moyen" | "long" | "">("");
  const [qcmTone, setQcmTone] = useState<"formel" | "semi-formel" | "direct" | "challenger" | "">("");
  const [qcmObjectif, setQcmObjectif] = useState<"rdv" | "ressource" | "qualifier" | "reactiver" | "">("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [showCrmPopup, setShowCrmPopup] = useState(false);

  // Manual composer-side draft (no CRM contact selected — uses name+company or LinkedIn URL)
  const [manualOpen, setManualOpen] = useState(false);
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualLinkedinUrl, setManualLinkedinUrl] = useState("");
  const [manualContext, setManualContext] = useState("");
  const [manualGenerating, setManualGenerating] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // AI explanation + guide modal
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isAiSearch, setIsAiSearch] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [guideContent, setGuideContent] = useState("");
  const [savingGuide, setSavingGuide] = useState(false);
  const [savedGuide, setSavedGuide] = useState(false);

  // Owner filter
  const [ownerFilter, setOwnerFilter] = useState<"mine" | "all">("mine");

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-detect HubSpot owner
    fetch("/api/hubspot/auto-link-owner").catch(() => {});
  }, []);

  // Load guide content on mount
  useEffect(() => {
    fetch("/api/settings/guide")
      .then((r) => r.json())
      .then(({ guide, default: def }) => setGuideContent(guide ?? def ?? ""))
      .catch(() => {});
  }, []);

  // Auto-load initial prospects
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll (individual)
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) loadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMore]);

  const fromEmail = user?.emailAddresses[0]?.emailAddress ?? "";

  // ── Guide helpers ──
  const saveGuide = async () => {
    setSavingGuide(true);
    try {
      await fetch("/api/settings/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guide: guideContent }),
      });
      setSavedGuide(true);
      setTimeout(() => setSavedGuide(false), 2000);
    } catch { /* ignore */ } finally {
      setSavingGuide(false);
    }
  };

  // ── Composer helpers ──
  const addTo = (t: string) => setTo((p) => p.includes(t) ? p : [...p, t]);
  const addCc = (t: string) => setCc((p) => p.includes(t) ? p : [...p, t]);
  const addBcc = (t: string) => setBcc((p) => p.includes(t) ? p : [...p, t]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) setAttachments((p) => [...p, ...files]);
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.append("to", to.join(","));
    fd.append("cc", cc.join(","));
    fd.append("bcc", bcc.join(","));
    fd.append("subject", subject);
    fd.append("body", body);
    fd.append("source", "prospecting");
    if (selectedContact?.id) fd.append("hubspot_id", selectedContact.id);
    attachments.forEach((f) => fd.append("attachments", f));
    return fd;
  };

  const send = async () => {
    if (!to.length || !subject || !body) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch("/api/gmail/send", { method: "POST", body: buildFormData() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSendStatus({ type: "success", msg: "Email envoyé !" });
      setTo([]); setCc([]); setBcc([]); setSubject(""); setBody(""); setAttachments([]);
    } catch (e) {
      setSendStatus({ type: "error", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async () => {
    if (!subject && !body) return;
    setDrafting(true);
    setSendStatus(null);
    try {
      const r = await fetch("/api/gmail/draft", { method: "POST", body: buildFormData() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSendStatus({ type: "success", msg: "Brouillon sauvegardé !" });
    } catch (e) {
      setSendStatus({ type: "error", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setDrafting(false);
    }
  };

  // ── Agent helpers ──
  const buildSearchUrl = (cursor?: string) => {
    const params = new URLSearchParams();
    if (simpleQuery.trim()) params.set("q", simpleQuery.trim());
    if (filterLifecycle) params.set("lifecyclestage", filterLifecycle);
    if (filterIndustry) params.set("industry", filterIndustry);
    if (filterCountry) params.set("country", filterCountry);
    if (filterLeadStatus) params.set("leadstatus", filterLeadStatus);
    if (filterContacted) params.set("contacted", filterContacted);
    if (filterCompanySize) params.set("companysize", filterCompanySize);
    if (filterSource) params.set("source", filterSource);
    if (filterCreatedYear) params.set("createdyear", filterCreatedYear);
    if (filterSort) params.set("sort", filterSort);
    if (ownerFilter === "all") params.set("owner", "all");
    if (cursor) params.set("after", cursor);
    return `/api/prospection/search?${params.toString()}`;
  };

  const searchSimple = async () => {
    setSearching(true);
    setIsAiSearch(false);
    setSearchError(null);
    setSearchResults([]);
    setNextCursor(null);
    setTotalResults(null);
    setAiExplanation(null);
    try {
      const r = await fetch(buildSearchUrl());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSearchResults(data.results ?? []);
      setNextCursor(data.nextCursor ?? null);
      setTotalResults(data.total ?? null);
      if ((data.results ?? []).length === 0) setSearchError("Aucun prospect trouvé.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Erreur de recherche");
    } finally {
      setSearching(false);
    }
  };

  const searchAI = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setIsAiSearch(true);
    setSearchError(null);
    setSearchResults([]);
    setNextCursor(null);
    setTotalResults(null);
    setAiExplanation(null);
    try {
      const r = await fetch("/api/prospection/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          lifecyclestage: filterLifecycle || undefined,
          industry: filterIndustry || undefined,
          country: filterCountry || undefined,
          leadstatus: filterLeadStatus || undefined,
          contacted: filterContacted || undefined,
          companysize: filterCompanySize || undefined,
          source: filterSource || undefined,
          createdyear: filterCreatedYear || undefined,
          ownerFilter: ownerFilter === "all" ? "all" : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSearchResults(data.results ?? []);
      setAiExplanation(data.explanation ?? null);
      if ((data.results ?? []).length === 0) setSearchError("Aucun prospect trouvé.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Erreur de recherche");
    } finally {
      setSearching(false);
    }
  };

  const search = () => {
    if (searchQuery.trim()) return searchAI();
    return searchSimple();
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetch(buildSearchUrl(nextCursor));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSearchResults((p) => [...p, ...(data.results ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch { /* silently ignore */ } finally {
      setLoadingMore(false);
    }
  };

  // Re-run search when filters change (if a search was already done)
  useEffect(() => {
    if (searchResults.length > 0 || searchError) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLifecycle, filterIndustry, filterCountry, filterLeadStatus, filterContacted, filterCompanySize, filterSource, filterCreatedYear, filterSort, ownerFilter]);

  const selectContact = async (result: SearchResult) => {
    setLoadingDetails(true);
    setAgentStep(2);
    setSelectedContact(null);
    setRecentNews("");
    setCompanyContext("");
    setCoachingNeed("");
    setAngle("");
    try {
      const r = await fetch(`/api/prospection/details?id=${result.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSelectedContact({ ...data, linkedinUrl: data.linkedinUrl ?? result.linkedinUrl ?? null });
      setContactIndustry(data.industry ?? "");
      // Pre-fill suggestion fields if Claude found something
      if (data.suggestedAnalysis) setAnalysis(data.suggestedAnalysis);
      if (data.suggestedRecentNews) setRecentNews(data.suggestedRecentNews);
      if (data.suggestedCompanyContext) setCompanyContext(data.suggestedCompanyContext);
      if (data.suggestedCoachingNeed) setCoachingNeed(data.suggestedCoachingNeed);
      if (data.suggestedAngle) setAngle(data.suggestedAngle);
    } catch {
      setContactIndustry(result.industry ?? "");
      setSelectedContact({ ...result, leadStatus: "", crmSummary: "", crmDetails: [] });
    } finally {
      setLoadingDetails(false);
    }
  };

  const generate = async () => {
    if (!selectedContact) return;
    setGenerating(true);
    setGenError(null);
    try {
      const r = await fetch("/api/prospection/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactInfo: { ...selectedContact, industry: contactIndustry },
          recentNews,
          companyContext,
          coachingNeed,
          angle,
          userInstructions,
          qcmType: qcmType || undefined,
          qcmLength: qcmLength || undefined,
          qcmTone: qcmTone || undefined,
          qcmObjectif: qcmObjectif || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // Populate composer
      if (selectedContact.email) setTo([selectedContact.email]);
      if (data.subject) setSubject(data.subject);
      if (data.body) setBody(data.body);
      setAgentStep(3);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Erreur de génération");
    } finally {
      setGenerating(false);
    }
  };

  const generateManual = async () => {
    const hasIdentity = (manualFirstName.trim() && manualCompany.trim()) || manualLinkedinUrl.trim() || to[0];
    if (!hasIdentity) {
      setManualError("Renseigne au minimum prénom + entreprise, ou une URL LinkedIn, ou un email destinataire.");
      return;
    }
    setManualGenerating(true);
    setManualError(null);
    try {
      const r = await fetch("/api/prospection/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactInfo: {
            firstName: manualFirstName.trim(),
            lastName: manualLastName.trim(),
            email: to[0] ?? "",
            jobTitle: "",
            company: manualCompany.trim(),
            industry: "",
            lifecyclestage: "",
            crmSummary: "",
            linkedinUrl: manualLinkedinUrl.trim() || null,
          },
          recentNews: manualContext,
          companyContext: "",
          coachingNeed: "",
          angle: "",
          userInstructions,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.subject) setSubject(data.subject);
      if (data.body) setBody(data.body);
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Erreur de génération");
    } finally {
      setManualGenerating(false);
    }
  };

  const backToResults = () => {
    setAgentStep(1);
    setSelectedContact(null);
    setAnalysis("");
    setRecentNews("");
    setCompanyContext("");
    setCoachingNeed("");
    setAngle("");
    setUserInstructions("");
    setContactIndustry("");
    setQcmType("");
    setQcmLength("");
    setQcmTone("");
    setQcmObjectif("");
  };

  const resetAgent = () => {
    setAgentStep(1);
    setSearchQuery("");
    setFilterLifecycle("");
    setFilterIndustry("");
    setFilterCountry("");
    setFilterLeadStatus("");
    setFilterContacted("");
    setFilterCompanySize("");
    setFilterSource("");
    setFilterCreatedYear("");
    setFilterSort("");
    setSearchResults([]);
    setNextCursor(null);
    setTotalResults(null);
    setSearchError(null);
    setAiExplanation(null);
    setIsAiSearch(false);
    setSelectedContact(null);
    setAnalysis("");
    setRecentNews("");
    setCompanyContext("");
    setCoachingNeed("");
    setAngle("");
    setUserInstructions("");
    setContactIndustry("");
    setQcmType("");
    setQcmLength("");
    setQcmTone("");
    setQcmObjectif("");
    setGenError(null);
  };

  const canSend = to.length > 0 && !!subject && !!body && !!gmailConnected && !sending;
  const canDraft = (!!subject || !!body) && !!gmailConnected && !drafting;
  const canGenerate = !!selectedContact?.email && !!selectedContact?.company && !generating;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: "#111" }}>Prospection</h1>
          <p className="text-xs" style={{ color: "#aaa" }}>Génère et envoie des emails de prospection ultra-personnalisés</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowGuide(true)}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: "#e5e5e5", color: "#555" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
          >
            Guide
          </button>
          {gmailConnected === false && (
            <Link
              href="/settings"
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "#fff0f3", color: "#f01563", border: "1px solid #fecdd3" }}
            >
              Connecter Gmail →
            </Link>
          )}
          {gmailConnected === true && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: "#f0fdf4", color: "#16a34a" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Gmail connecté
            </span>
          )}
        </div>
      </div>

      {/* Guide modal */}
      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowGuide(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowGuide(false); }}
        >
          <div className="flex flex-col rounded-2xl shadow-2xl w-full max-w-2xl mx-4" style={{ background: "#fff", maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#111" }}>Guide Prospection</p>
                <p className="text-xs" style={{ color: "#aaa" }}>Claude utilise ce guide pour rédiger tes emails</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveGuide}
                  disabled={savingGuide}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: savedGuide ? "#22c55e" : "#f01563", color: "#fff", opacity: savingGuide ? 0.7 : 1 }}
                >
                  <Save size={12} />
                  {savedGuide ? "Sauvegardé !" : savingGuide ? "…" : "Sauvegarder"}
                </button>
                <button onClick={() => setShowGuide(false)} style={{ color: "#aaa" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#111")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#aaa")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-5 overflow-y-auto">
              <p className="text-xs mb-3" style={{ color: "#aaa" }}>
                Ajoute ici des exemples d&apos;emails, le ton à adopter, les cibles prioritaires. Ce guide est personnel et privé.
              </p>
              <textarea
                value={guideContent}
                onChange={(e) => setGuideContent(e.target.value)}
                placeholder="Ex : Toujours commencer par une accroche personnalisée. Voici un exemple d'email réussi…"
                className="w-full rounded-xl border p-4 text-sm font-mono resize-none outline-none transition-all"
                style={{ borderColor: "#e5e5e5", color: "#111", background: "#fafafa", minHeight: "50vh", lineHeight: 1.7 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
              />
            </div>
          </div>
        </div>
      )}

      {/* CRM history popup */}
      {showCrmPopup && selectedContact && (() => {
        return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCrmPopup(false); }}
        >
          <div className="flex flex-col rounded-2xl shadow-2xl w-full max-w-2xl mx-4" style={{ background: "#fff", maxHeight: "85vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "#111" }}>Historique CRM</p>
                <p className="text-xs mt-0.5" style={{ color: "#999" }}>
                  {selectedContact.firstName} {selectedContact.lastName} · {selectedContact.company}
                </p>
              </div>
              <button onClick={() => setShowCrmPopup(false)} className="rounded-lg p-1.5 transition-colors hover:bg-gray-100" style={{ color: "#999" }}>
                <X size={18} />
              </button>
            </div>
            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {selectedContact.crmDetails.length > 0 ? (
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-px" style={{ background: "#e5e7eb" }} />
                  <div className="space-y-5">
                    {selectedContact.crmDetails.map((e, i) => {
                      const cfg = CRM_TYPE_CONFIG[e.type] ?? CRM_TYPE_FALLBACK;
                      const Icon = cfg.icon;
                      const isLong = e.body.length > 280;
                      return (
                        <div key={i} className="relative flex gap-4">
                          {/* Icon dot */}
                          <div className="relative z-10 shrink-0 w-[31px] h-[31px] rounded-full flex items-center justify-center" style={{ background: cfg.bg, border: `1.5px solid ${cfg.color}20` }}>
                            <Icon size={14} style={{ color: cfg.color }} />
                          </div>
                          {/* Card */}
                          <div className="flex-1 min-w-0 rounded-xl border p-4" style={{ borderColor: "#e5e7eb", background: "#fafafa" }}>
                            <div className="flex items-center gap-2.5 mb-2">
                              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>
                                {cfg.label}
                              </span>
                              {e.date && <span className="text-[11px]" style={{ color: "#999" }}>{e.date}</span>}
                            </div>
                            <div className="text-[13px] leading-[1.65] whitespace-pre-wrap" style={{ color: "#444" }}>
                              {isLong ? (
                                <CrmBodyToggle body={e.body} />
                              ) : e.body}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-center py-8" style={{ color: "#aaa" }}>{selectedContact.crmSummary}</p>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">

      <>

        {/* ── LEFT: Email composer ───────────────────────────────────────────── */}
        <div className="w-1/2 border-r flex flex-col overflow-hidden" style={{ borderColor: "#f0f0f0" }}>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="rounded-2xl border shadow-sm overflow-hidden h-full flex flex-col" style={{ borderColor: "#e5e5e5" }}>

              {gmailConnected === false && (
                <div className="px-4 py-2.5 text-xs text-center shrink-0" style={{ background: "#fff8f0", color: "#c2410c", borderBottom: "1px solid #ffe4c4" }}>
                  Gmail non connecté —{" "}
                  <Link href="/settings" className="underline font-medium">connecte-le dans Settings</Link>
                  {" "}pour envoyer.
                </div>
              )}

              {/* From */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>De</span>
                <span className="text-sm" style={{ color: "#888" }}>{fromEmail || "…"}</span>
              </div>

              {/* To */}
              <TagInput label="À" tags={to} onAdd={addTo} onRemove={(t) => setTo((p) => p.filter((x) => x !== t))} placeholder="destinataire@email.com — Entrée pour ajouter" />

              {showCc && (
                <TagInput label="Cc" tags={cc} onAdd={addCc} onRemove={(t) => setCc((p) => p.filter((x) => x !== t))} placeholder="cc@email.com" />
              )}
              {showBcc && (
                <TagInput label="Bcc" tags={bcc} onAdd={addBcc} onRemove={(t) => setBcc((p) => p.filter((x) => x !== t))} placeholder="bcc@email.com" />
              )}

              {(!showCc || !showBcc) && (
                <div className="flex gap-3 px-4 py-1.5 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
                  {!showCc && (
                    <button onClick={() => setShowCc(true)} className="text-xs transition-colors" style={{ color: "#ccc" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#f01563")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
                    >+ Cc</button>
                  )}
                  {!showBcc && (
                    <button onClick={() => setShowBcc(true)} className="text-xs transition-colors" style={{ color: "#ccc" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#f01563")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
                    >+ Bcc</button>
                  )}
                </div>
              )}

              {/* Subject */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
                <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>Objet</span>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet de l'email"
                  className="flex-1 text-sm outline-none bg-transparent font-medium" style={{ color: "#111" }} />
              </div>

              {/* Manual AI-draft assistant (works without CRM selection) */}
              <div className="border-b shrink-0" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                <button
                  onClick={() => setManualOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2 text-xs transition-colors"
                  style={{ color: manualOpen ? "#111" : "#888" }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles size={12} style={{ color: "#f01563" }} />
                    Assistant IA — rédiger sans contact CRM
                  </span>
                  {manualOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {manualOpen && (
                  <div className="px-4 pb-3 space-y-2">
                    <p className="text-[10px]" style={{ color: "#aaa" }}>
                      Renseigne <b>prénom + entreprise</b> (Claude trouvera le LinkedIn) ou colle directement une <b>URL LinkedIn</b>. Tous les champs sont optionnels — l&apos;email destinataire (champ &quot;À&quot;) est aussi utilisé pour retrouver le profil.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={manualFirstName}
                        onChange={(e) => setManualFirstName(e.target.value)}
                        placeholder="Prénom"
                        className="text-xs px-2.5 py-1.5 rounded-lg border outline-none"
                        style={{ borderColor: "#e5e5e5", background: "#fff" }}
                      />
                      <input
                        type="text"
                        value={manualLastName}
                        onChange={(e) => setManualLastName(e.target.value)}
                        placeholder="Nom"
                        className="text-xs px-2.5 py-1.5 rounded-lg border outline-none"
                        style={{ borderColor: "#e5e5e5", background: "#fff" }}
                      />
                    </div>
                    <input
                      type="text"
                      value={manualCompany}
                      onChange={(e) => setManualCompany(e.target.value)}
                      placeholder="Entreprise"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none"
                      style={{ borderColor: "#e5e5e5", background: "#fff" }}
                    />
                    <div className="relative">
                      <Linkedin size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#0a66c2" }} />
                      <input
                        type="text"
                        value={manualLinkedinUrl}
                        onChange={(e) => setManualLinkedinUrl(e.target.value)}
                        placeholder="URL LinkedIn (optionnel) — https://www.linkedin.com/in/…"
                        className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-lg border outline-none"
                        style={{ borderColor: "#e5e5e5", background: "#fff" }}
                      />
                    </div>
                    <textarea
                      value={manualContext}
                      onChange={(e) => setManualContext(e.target.value)}
                      placeholder="Contexte / actualité / angle (optionnel)"
                      rows={2}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none resize-none"
                      style={{ borderColor: "#e5e5e5", background: "#fff" }}
                    />
                    {manualError && (
                      <p className="text-[11px] px-2 py-1.5 rounded" style={{ background: "#fff0f3", color: "#f01563" }}>
                        {manualError}
                      </p>
                    )}
                    <button
                      onClick={generateManual}
                      disabled={manualGenerating}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity"
                      style={{ background: "#f01563", color: "#fff", opacity: manualGenerating ? 0.6 : 1 }}
                    >
                      {manualGenerating ? (
                        <><Loader2 size={12} className="animate-spin" /> Génération…</>
                      ) : (
                        <><Sparkles size={12} /> Générer l&apos;email</>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Body */}
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Écris ton email ici…"
                className="flex-1 resize-none outline-none text-sm leading-relaxed p-4"
                style={{ color: "#111", minHeight: "200px" }} />

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="px-4 py-2.5 border-t flex flex-wrap gap-2 shrink-0" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                  {attachments.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: "#f0f0f0", color: "#555" }}>
                      <Paperclip size={10} />
                      {f.name}
                      <span className="text-[10px]" style={{ color: "#aaa" }}>({(f.size / 1024).toFixed(0)} Ko)</span>
                      <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="hover:opacity-70 flex items-center ml-0.5">
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t shrink-0" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                <div>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} />
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: "#bbb" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#555")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#bbb")}
                  >
                    <Paperclip size={14} />
                    Joindre
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {sendStatus && (
                    <span className="text-xs" style={{ color: sendStatus.type === "success" ? "#16a34a" : "#f01563" }}>
                      {sendStatus.msg}
                    </span>
                  )}
                  <button onClick={saveDraft} disabled={!canDraft}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: canDraft ? "#d4d4d4" : "#eee", color: canDraft ? "#555" : "#ccc", cursor: canDraft ? "pointer" : "not-allowed" }}
                  >
                    <Save size={12} />
                    {drafting ? "…" : "Brouillon"}
                  </button>
                  <button onClick={send} disabled={!canSend}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-opacity"
                    style={{ background: "#f01563", color: "#fff", opacity: canSend ? 1 : 0.4, cursor: canSend ? "pointer" : "not-allowed" }}
                  >
                    <Send size={12} />
                    {sending ? "Envoi…" : "Envoyer"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Prospection agent ───────────────────────────────────────── */}
        <div className="w-1/2 flex flex-col overflow-hidden" style={{ background: "#fafafa" }}>
          <div className="flex-1 overflow-y-auto p-5">

            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-5">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold"
                    style={{
                      background: agentStep >= s ? "#f01563" : "#e5e5e5",
                      color: agentStep >= s ? "#fff" : "#aaa",
                    }}
                  >
                    {s}
                  </div>
                  <span className="text-xs" style={{ color: agentStep >= s ? "#111" : "#bbb" }}>
                    {s === 1 ? "Recherche" : s === 2 ? "Informations" : "Génération"}
                  </span>
                  {s < 3 && <ChevronRight size={12} style={{ color: "#ddd" }} />}
                </div>
              ))}
              {agentStep > 1 && (
                <button onClick={resetAgent} className="ml-auto flex items-center gap-1 text-xs" style={{ color: "#bbb" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#555")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#bbb")}
                >
                  <RotateCcw size={11} /> Recommencer
                </button>
              )}
            </div>

            {/* ── STEP 1: Search ── */}
            {agentStep === 1 && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: "#111" }}>Prospects HubSpot</p>
                  <p className="text-xs" style={{ color: "#aaa" }}>Tape un nom, email ou une requête en langage naturel</p>
                </div>

                {/* Search bars */}
                <div className="flex gap-2">
                  {/* Simple search */}
                  <div className="flex-1 flex gap-1.5">
                    <input
                      type="text"
                      value={simpleQuery}
                      onChange={(e) => setSimpleQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchSimple()}
                      placeholder="Nom, email, entreprise…"
                      className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none transition-all"
                      style={{ borderColor: "#e5e5e5", color: "#111", background: "#fff" }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
                    />
                    <button
                      onClick={searchSimple}
                      disabled={searching}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-opacity whitespace-nowrap"
                      style={{ background: "#f01563", color: "#fff", opacity: searching && !isAiSearch ? 0.7 : 1 }}
                    >
                      {searching && !isAiSearch ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Rechercher
                    </button>
                  </div>

                  {/* AI search */}
                  <div className="flex-1 flex gap-1.5">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchAI()}
                      placeholder="Demande à l'IA…"
                      className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none transition-all"
                      style={{ borderColor: "#e5e5e5", color: "#111", background: "#fff" }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
                    />
                    <button
                      onClick={searchAI}
                      disabled={searching || !searchQuery.trim()}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-opacity whitespace-nowrap"
                      style={{ background: "#7c3aed", color: "#fff", opacity: searching && isAiSearch ? 0.7 : !searchQuery.trim() ? 0.5 : 1 }}
                    >
                      {searching && isAiSearch ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      IA
                    </button>
                  </div>
                </div>

                {/* AI status message */}
                {searching && isAiSearch && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: "#7c3aed" }}>
                    <Loader2 size={11} className="animate-spin" />
                    L&apos;IA analyse ta demande et cherche dans HubSpot…
                  </p>
                )}

                {/* Owner toggle */}
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "#e5e5e5", width: "fit-content" }}>
                  {(["mine", "all"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => { setOwnerFilter(v); }}
                      className="px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: ownerFilter === v ? "#111827" : "#fff",
                        color: ownerFilter === v ? "#fff" : "#6b7280",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {v === "mine" ? "Mes contacts" : "Tous"}
                    </button>
                  ))}
                </div>

                {/* Filters */}
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <FilterSelect value={filterLifecycle} onChange={setFilterLifecycle} label="Lifecycle">
                      <option value="subscriber">Abonné</option>
                      <option value="lead">Lead</option>
                      <option value="marketingqualifiedlead">MQL</option>
                      <option value="salesqualifiedlead">SQL</option>
                      <option value="opportunity">Opportunité</option>
                      <option value="customer">Client</option>
                    </FilterSelect>
                    <FilterSelect value={filterIndustry} onChange={setFilterIndustry} label="Secteur">
                      {[...new Set(searchResults.map((r) => r.industry).filter(Boolean))].sort().map((ind) => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </FilterSelect>
                    <FilterSelect value={filterCountry} onChange={setFilterCountry} label="Pays">
                      {[...new Set(searchResults.map((r) => r.country).filter(Boolean))].sort().map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </FilterSelect>
                    <FilterSelect value={filterLeadStatus} onChange={setFilterLeadStatus} label="Statut lead">
                      <option value="NEW">Nouveau</option>
                      <option value="OPEN">Ouvert</option>
                      <option value="IN_PROGRESS">En cours</option>
                      <option value="ATTEMPTED_TO_CONTACT">Contacté</option>
                      <option value="CONNECTED">Connecté</option>
                      <option value="BAD_TIMING">Mauvais timing</option>
                      <option value="UNQUALIFIED">Non qualifié</option>
                    </FilterSelect>
                    <FilterSelect value={filterContacted} onChange={setFilterContacted} label="Dernier contact">
                      <option value="never">Jamais contacté</option>
                      <option value="lt7">Moins de 7j</option>
                      <option value="lt30">Moins de 30j</option>
                      <option value="30to60">30 – 60j</option>
                      <option value="60to180">60j – 6 mois</option>
                      <option value="180to365">6 – 12 mois</option>
                      <option value="gt365">Plus d'1 an</option>
                    </FilterSelect>
                    <FilterSelect value={filterCompanySize} onChange={setFilterCompanySize} label="Taille">
                      <option value="1-10">1 – 10</option>
                      <option value="11-50">11 – 50</option>
                      <option value="51-200">51 – 200</option>
                      <option value="201-1000">201 – 1000</option>
                      <option value="1000+">+ 1000</option>
                    </FilterSelect>
                    <FilterSelect value={filterSource} onChange={setFilterSource} label="Source">
                      <option value="ORGANIC_SEARCH">Recherche organique</option>
                      <option value="DIRECT_TRAFFIC">Trafic direct</option>
                      <option value="EMAIL_MARKETING">Email marketing</option>
                      <option value="PAID_SEARCH">Recherche payante</option>
                      <option value="REFERRALS">Référence</option>
                      <option value="SOCIAL_MEDIA">Réseaux sociaux</option>
                      <option value="OFFLINE">Hors ligne</option>
                      <option value="OTHER">Autre</option>
                    </FilterSelect>
                    <FilterSelect value={filterCreatedYear} onChange={setFilterCreatedYear} label="Créé en">
                      {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map((y) => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </FilterSelect>
                    <FilterSelect value={filterSort} onChange={setFilterSort} label="Trier par">
                      <option value="recent">Modifié récemment</option>
                      <option value="created">Date de création</option>
                      <option value="lastcontact">Dernier contact</option>
                      <option value="alpha">Alphabétique</option>
                    </FilterSelect>
                  </div>
                  <div className="flex items-center gap-2">
                    {(filterLifecycle || filterIndustry || filterCountry || filterLeadStatus || filterContacted || filterCompanySize || filterSource || filterCreatedYear) && (
                      <button
                        onClick={() => { setFilterLifecycle(""); setFilterIndustry(""); setFilterCountry(""); setFilterLeadStatus(""); setFilterContacted(""); setFilterCompanySize(""); setFilterSource(""); setFilterCreatedYear(""); setFilterSort(""); }}
                        className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors"
                        style={{ color: "#f01563", background: "#fff0f5" }}
                      >
                        <X size={10} /> Reset
                      </button>
                    )}
                    {totalResults !== null && (
                      <span className="ml-auto text-xs" style={{ color: "#aaa" }}>
                        {totalResults} prospect{totalResults > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>

                {searchError && (
                  <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fff0f3", color: "#f01563" }}>
                    {searchError}
                  </p>
                )}

                {/* AI explanation */}
                {aiExplanation && (
                  <p className="text-xs px-3 py-2 rounded-lg flex items-start gap-2" style={{ background: "#f5f3ff", color: "#7c3aed" }}>
                    <Sparkles size={12} className="shrink-0 mt-0.5" />
                    {aiExplanation}
                  </p>
                )}

                {/* Results grid */}
                {searchResults.length > 0 && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {searchResults.map((r) => (
                        <ProspectCard
                          key={r.id}
                          result={r}
                          onSelect={() => selectContact(r)}
                          exchanges={Math.max(countByEmail(r.email), countByHubspotId(r.id))}
                        />
                      ))}
                    </div>

                    {/* Infinite scroll sentinel */}
                    <div ref={sentinelRef} className="h-4" />
                    {loadingMore && (
                      <div className="flex justify-center py-2">
                        <Loader2 size={14} className="animate-spin" style={{ color: "#bbb" }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: Info ── */}
            {agentStep === 2 && (
              <div className="space-y-4">
                <button
                  onClick={backToResults}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "#aaa" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#555")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#aaa")}
                >
                  ← Retour aux résultats
                </button>
                {loadingDetails ? (
                  <div className="flex items-center gap-3 py-8 justify-center">
                    <Loader2 size={18} className="animate-spin" style={{ color: "#f01563" }} />
                    <span className="text-sm" style={{ color: "#888" }}>Chargement des données HubSpot…</span>
                  </div>
                ) : selectedContact && (
                  <>
                    {/* Analysis bloc */}
                    {analysis && (
                      <div className="rounded-xl px-4 py-3" style={{ background: "#f5f5f5", border: "1px solid #ebebeb" }}>
                        <p className="text-[10px] font-semibold mb-1" style={{ color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em" }}>Analyse</p>
                        <p className="text-xs leading-relaxed italic" style={{ color: "#555" }}>{analysis}</p>
                      </div>
                    )}

                    {/* Contact card */}
                    <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                          style={{ background: "#f01563", color: "#fff" }}
                        >
                          {(selectedContact.firstName?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "#111" }}>
                            {selectedContact.firstName} {selectedContact.lastName}
                          </p>
                          <p className="text-xs" style={{ color: "#888" }}>
                            {[selectedContact.jobTitle, selectedContact.company].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </div>
                      {/* Contact metadata */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Mail size={12} style={{ color: "#bbb" }} />
                          <span className="text-xs" style={{ color: "#555" }}>{selectedContact.email}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selectedContact.lifecyclestage && <LifecycleBadge stage={selectedContact.lifecyclestage} />}
                          {selectedContact.leadStatus && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: "#f0f0f0", color: "#888" }}>
                              {selectedContact.leadStatus}
                            </span>
                          )}
                        </div>
                        <Field label="Secteur" value={contactIndustry} onChange={setContactIndustry} placeholder="ex: Technology" />
                      </div>

                      {/* Mini CRM timeline */}
                      {(selectedContact.crmDetails?.length > 0 || selectedContact.crmSummary) && (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #f0f0f0" }}>
                          <span className="text-[11px] font-medium" style={{ color: "#888" }}>Historique CRM</span>
                          {selectedContact.crmDetails?.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {selectedContact.crmDetails.slice(0, 3).map((e, i) => {
                                const cfg = CRM_TYPE_CONFIG[e.type] ?? CRM_TYPE_FALLBACK;
                                const Icon = cfg.icon;
                                return (
                                  <div key={i} className="flex items-start gap-2.5">
                                    <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5" style={{ background: cfg.bg }}>
                                      <Icon size={11} style={{ color: cfg.color }} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                                        {e.date && <span className="text-[10px]" style={{ color: "#bbb" }}>{e.date}</span>}
                                      </div>
                                      <p className="text-[11px] leading-snug mt-0.5 line-clamp-1" style={{ color: "#666" }}>{e.body}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : selectedContact.crmSummary ? (
                            <p className="text-[11px] mt-1.5 line-clamp-2" style={{ color: "#888" }}>{selectedContact.crmSummary}</p>
                          ) : null}
                          <button
                            onClick={() => setShowCrmPopup(true)}
                            className="text-[10px] font-medium mt-2 block transition-opacity hover:opacity-80"
                            style={{ color: "#f01563" }}
                          >
                            Voir tout l&apos;historique →
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Manual fields */}
                    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                      <p className="text-xs font-semibold" style={{ color: "#111" }}>Contexte supplémentaire</p>
                      <Field
                        label="Actualité récente / contexte externe"
                        value={recentNews}
                        onChange={setRecentNews}
                        placeholder="Ex : levée de fonds annoncée, post LinkedIn sur le leadership…"
                        multiline
                      />
                      <Field
                        label="Contexte de l'entreprise"
                        value={companyContext}
                        onChange={setCompanyContext}
                        placeholder="Ex : scale-up 200 personnes en hypercroissance, réorganisation en cours…"
                        multiline
                      />
                      <Field
                        label="Pourquoi pourrait-il avoir besoin de coaching ?"
                        value={coachingNeed}
                        onChange={setCoachingNeed}
                        placeholder="Ex : turnover élevé, nouveau manager en difficulté, transformation culturelle…"
                        multiline
                      />
                      <Field
                        label="Angle d'attaque / message clé"
                        value={angle}
                        onChange={setAngle}
                        placeholder="Ex : ROI mesurable, benchmarks sectoriels, cas client similaire…"
                        multiline
                      />
                      {selectedContact.linkedinUrl && (
                        <div className="pt-3" style={{ borderTop: "1px solid #f0f0f0" }}>
                          <p className="text-[11px] font-medium mb-1.5" style={{ color: "#888" }}>Profil LinkedIn</p>
                          <a
                            href={selectedContact.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                            style={{ borderColor: "#e5e5e5", color: "#0a66c2", background: "#f5f5f5" }}
                          >
                            <Linkedin size={12} />
                            <span className="truncate max-w-[260px]">{selectedContact.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
                          </a>
                          <p className="text-[10px] mt-1.5" style={{ color: "#aaa" }}>
                            Vérifie que c&apos;est bien la bonne personne — son parcours sera utilisé pour personnaliser le message.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Instructions block */}
                    <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                      <p className="text-xs font-semibold mb-3" style={{ color: "#111" }}>Instructions pour Claude</p>
                      <Field
                        label="Consignes / ton / contraintes"
                        value={userInstructions}
                        onChange={setUserInstructions}
                        placeholder="Ex : Sois très bref, commence par une accroche sur la croissance, évite de parler de prix…"
                        multiline
                      />
                    </div>

                    {/* QCM targeting */}
                    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                      <p className="text-xs font-semibold" style={{ color: "#111" }}>Ciblage du message</p>
                      {([
                        {
                          label: "Type",
                          value: qcmType,
                          setter: setQcmType,
                          options: [
                            { v: "intro", label: "Intro" },
                            { v: "followup", label: "Follow-up" },
                          ],
                        },
                        {
                          label: "Longueur",
                          value: qcmLength,
                          setter: setQcmLength,
                          options: [
                            { v: "court", label: "Court" },
                            { v: "moyen", label: "Moyen" },
                            { v: "long", label: "Long" },
                          ],
                        },
                        {
                          label: "Ton",
                          value: qcmTone,
                          setter: setQcmTone,
                          options: [
                            { v: "formel", label: "Formel" },
                            { v: "semi-formel", label: "Semi-formel" },
                            { v: "direct", label: "Direct" },
                            { v: "challenger", label: "Challenger" },
                          ],
                        },
                        {
                          label: "Objectif",
                          value: qcmObjectif,
                          setter: setQcmObjectif,
                          options: [
                            { v: "rdv", label: "Obtenir un RDV" },
                            { v: "ressource", label: "Partager ressource" },
                            { v: "qualifier", label: "Qualifier" },
                            { v: "reactiver", label: "Réactiver" },
                          ],
                        },
                      ] as { label: string; value: string; setter: (v: string) => void; options: { v: string; label: string }[] }[]).map(({ label, value, setter, options }) => (
                        <div key={label}>
                          <p className="text-[11px] font-medium mb-1.5" style={{ color: "#888" }}>{label}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {options.map(({ v, label: optLabel }) => {
                              const selected = value === v;
                              return (
                                <button
                                  key={v}
                                  onClick={() => setter(selected ? "" : v)}
                                  className="text-xs px-2.5 py-1 rounded-full border transition-all"
                                  style={{
                                    background: selected ? "#f01563" : "#f5f5f5",
                                    color: selected ? "#fff" : "#555",
                                    borderColor: selected ? "#f01563" : "#e5e5e5",
                                    cursor: "pointer",
                                  }}
                                >
                                  {optLabel}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {genError && (
                      <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fff0f3", color: "#f01563" }}>
                        {genError}
                      </p>
                    )}

                    <button
                      onClick={generate}
                      disabled={!canGenerate}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity"
                      style={{ background: "#f01563", color: "#fff", opacity: canGenerate ? 1 : 0.5 }}
                    >
                      {generating ? (
                        <><Loader2 size={16} className="animate-spin" /> Génération en cours…</>
                      ) : (
                        <><Sparkles size={16} /> Générer l&apos;email</>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── STEP 3: Done ── */}
            {agentStep === 3 && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "#f0fdf4" }}>
                  <Sparkles size={24} style={{ color: "#16a34a" }} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold mb-1" style={{ color: "#111" }}>Email généré !</p>
                  <p className="text-xs" style={{ color: "#888" }}>
                    Le compositeur a été pré-rempli avec l&apos;objet et le corps de l&apos;email.
                    <br />Relis, ajuste si besoin, puis envoie.
                  </p>
                </div>
                <button
                  onClick={backToResults}
                  className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg border transition-colors"
                  style={{ borderColor: "#e5e5e5", color: "#555" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  ← Retour aux résultats
                </button>
              </div>
            )}
          </div>
        </div>

      </>

      </div>
    </div>
  );
}
