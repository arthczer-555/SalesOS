"use client";

import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { Paperclip, Send, Save, X, Search, Loader2, Sparkles, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
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
}

interface ContactDetails extends SearchResult {
  leadStatus: string;
  crmSummary: string;
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
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border text-xs outline-none transition-all cursor-pointer"
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

// ── Main ───────────────────────────────────────────────────────────────────

export default function ProspectingPage() {
  const { user } = useUser();

  // Gmail
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

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
  const [filterLifecycle, setFilterLifecycle] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterLeadStatus, setFilterLeadStatus] = useState("");
  const [filterContacted, setFilterContacted] = useState("");
  const [filterCompanySize, setFilterCompanySize] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterSort, setFilterSort] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedContact, setSelectedContact] = useState<ContactDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Manual fields
  const [contactIndustry, setContactIndustry] = useState("");
  const [recentNews, setRecentNews] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [coachingNeed, setCoachingNeed] = useState("");
  const [angle, setAngle] = useState("");
  const [userInstructions, setUserInstructions] = useState("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // AI explanation + guide modal
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isAiSearch, setIsAiSearch] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [guideContent, setGuideContent] = useState("");
  const [savingGuide, setSavingGuide] = useState(false);
  const [savedGuide, setSavedGuide] = useState(false);

  // Mode toggle
  const [mode, setMode] = useState<"individual" | "bulk">("individual");

  // Bulk states
  const [bulkSearchQuery, setBulkSearchQuery] = useState("");
  const [bulkFilterLifecycle, setBulkFilterLifecycle] = useState("");
  const [bulkFilterIndustry, setBulkFilterIndustry] = useState("");
  const [bulkFilterCountry, setBulkFilterCountry] = useState("");
  const [bulkFilterLeadStatus, setBulkFilterLeadStatus] = useState("");
  const [bulkFilterContacted, setBulkFilterContacted] = useState("");
  const [bulkFilterCompanySize, setBulkFilterCompanySize] = useState("");
  const [bulkFilterSource, setBulkFilterSource] = useState("");
  const [bulkFilterSort, setBulkFilterSort] = useState("");
  const [showBulkAdvancedFilters, setShowBulkAdvancedFilters] = useState(false);
  const [bulkResults, setBulkResults] = useState<SearchResult[]>([]);
  const [bulkNextCursor, setBulkNextCursor] = useState<string | null>(null);
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkLoadingMore, setBulkLoadingMore] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkContactsCache, setBulkContactsCache] = useState<Map<string, SearchResult>>(new Map());
  const [bulkManualEmails, setBulkManualEmails] = useState<{ id: string; email: string; firstName: string }[]>([]);
  const [bulkManualInput, setBulkManualInput] = useState("");
  const [bulkInstructions, setBulkInstructions] = useState("");
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkGenError, setBulkGenError] = useState<string | null>(null);
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSendResult, setBulkSendResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bulkSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then(({ connected }) => setGmailConnected(connected))
      .catch(() => setGmailConnected(false));
  }, []);

  // Load guide content on mount
  useEffect(() => {
    fetch("/api/prospection-guide")
      .then((r) => r.json())
      .then(({ content }) => setGuideContent(content ?? ""))
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

  // Infinite scroll (bulk)
  useEffect(() => {
    if (!bulkSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && bulkNextCursor && !bulkLoadingMore) bulkLoadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(bulkSentinelRef.current);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkNextCursor, bulkLoadingMore]);

  // Auto-load bulk contacts when entering bulk mode
  useEffect(() => {
    if (mode === "bulk" && bulkResults.length === 0 && !bulkSearching) {
      bulkSearch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fromEmail = user?.emailAddresses[0]?.emailAddress ?? "";

  // ── Guide helpers ──
  const saveGuide = async () => {
    setSavingGuide(true);
    try {
      await fetch("/api/prospection-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: guideContent }),
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
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (filterLifecycle) params.set("lifecyclestage", filterLifecycle);
    if (filterIndustry) params.set("industry", filterIndustry);
    if (filterCountry) params.set("country", filterCountry);
    if (filterLeadStatus) params.set("leadstatus", filterLeadStatus);
    if (filterContacted) params.set("contacted", filterContacted);
    if (filterCompanySize) params.set("companysize", filterCompanySize);
    if (filterSource) params.set("source", filterSource);
    if (filterSort) params.set("sort", filterSort);
    if (cursor) params.set("after", cursor);
    return `/api/prospection/search?${params.toString()}`;
  };

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    setNextCursor(null);
    setTotalResults(null);
    setAiExplanation(null);
    const useAI = searchQuery.trim().length > 0;
    setIsAiSearch(useAI);
    try {
      if (useAI) {
        const r = await fetch("/api/prospection/ai-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery.trim(),
            lifecyclestage: filterLifecycle || undefined,
            industry: filterIndustry || undefined,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setSearchResults(data.results ?? []);
        setAiExplanation(data.explanation ?? null);
        if ((data.results ?? []).length === 0) setSearchError("Aucun prospect trouvé.");
      } else {
        const r = await fetch(buildSearchUrl());
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setSearchResults(data.results ?? []);
        setNextCursor(data.nextCursor ?? null);
        setTotalResults(data.total ?? null);
        if ((data.results ?? []).length === 0) setSearchError("Aucun prospect trouvé.");
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Erreur de recherche");
    } finally {
      setSearching(false);
    }
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
  }, [filterLifecycle, filterIndustry, filterCountry, filterLeadStatus, filterContacted, filterCompanySize, filterSource, filterSort]);

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
      setSelectedContact(data);
      setContactIndustry(data.industry ?? "");
      // Pre-fill suggestion fields if Claude found something
      if (data.suggestedRecentNews) setRecentNews(data.suggestedRecentNews);
      if (data.suggestedCompanyContext) setCompanyContext(data.suggestedCompanyContext);
      if (data.suggestedCoachingNeed) setCoachingNeed(data.suggestedCoachingNeed);
      if (data.suggestedAngle) setAngle(data.suggestedAngle);
    } catch {
      setContactIndustry(result.industry ?? "");
      setSelectedContact({ ...result, leadStatus: "", crmSummary: "" });
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
    setFilterSort("");
    setSearchResults([]);
    setNextCursor(null);
    setTotalResults(null);
    setSearchError(null);
    setAiExplanation(null);
    setIsAiSearch(false);
    setSelectedContact(null);
    setRecentNews("");
    setCompanyContext("");
    setCoachingNeed("");
    setAngle("");
    setUserInstructions("");
    setContactIndustry("");
    setGenError(null);
  };

  // ── Bulk helpers ──
  const buildBulkSearchParams = (cursor?: string) => {
    const params = new URLSearchParams();
    if (bulkSearchQuery) params.set("q", bulkSearchQuery);
    if (bulkFilterLifecycle) params.set("lifecyclestage", bulkFilterLifecycle);
    if (bulkFilterIndustry) params.set("industry", bulkFilterIndustry);
    if (bulkFilterCountry) params.set("country", bulkFilterCountry);
    if (bulkFilterLeadStatus) params.set("leadstatus", bulkFilterLeadStatus);
    if (bulkFilterContacted) params.set("contacted", bulkFilterContacted);
    if (bulkFilterCompanySize) params.set("companysize", bulkFilterCompanySize);
    if (bulkFilterSource) params.set("source", bulkFilterSource);
    if (bulkFilterSort) params.set("sort", bulkFilterSort);
    if (cursor) params.set("after", cursor);
    return params;
  };

  const bulkSearch = async () => {
    setBulkSearching(true);
    setBulkResults([]);
    setBulkNextCursor(null);
    setBulkSendResult(null);
    const params = buildBulkSearchParams();
    try {
      const r = await fetch(`/api/prospection/search?${params}`);
      const data = await r.json();
      const results: SearchResult[] = data.results ?? [];
      setBulkResults(results);
      setBulkNextCursor(data.nextCursor ?? null);
      setBulkContactsCache((prev) => {
        const next = new Map(prev);
        for (const c of results) next.set(c.id, c);
        return next;
      });
    } catch {} finally {
      setBulkSearching(false);
    }
  };

  const bulkLoadMore = async () => {
    if (!bulkNextCursor || bulkLoadingMore) return;
    setBulkLoadingMore(true);
    const params = buildBulkSearchParams(bulkNextCursor);
    try {
      const r = await fetch(`/api/prospection/search?${params}`);
      const data = await r.json();
      const results: SearchResult[] = data.results ?? [];
      setBulkResults((prev) => [...prev, ...results]);
      setBulkNextCursor(data.nextCursor ?? null);
      setBulkContactsCache((prev) => {
        const next = new Map(prev);
        for (const c of results) next.set(c.id, c);
        return next;
      });
    } catch {} finally {
      setBulkLoadingMore(false);
    }
  };

  const bulkGenerate = async () => {
    // Collect all selected HubSpot contacts (results first, then cache for pinned)
    const hubspotContacts: SearchResult[] = [];
    for (const id of bulkSelectedIds) {
      if (id.startsWith("manual-")) continue;
      const fromResult = bulkResults.find((r) => r.id === id);
      if (fromResult) { hubspotContacts.push(fromResult); continue; }
      const fromCache = bulkContactsCache.get(id);
      if (fromCache) hubspotContacts.push(fromCache);
    }
    // Manual emails selected
    const manualSelected = bulkManualEmails.filter((m) => bulkSelectedIds.has(m.id));

    if (!hubspotContacts.length && !manualSelected.length) {
      setBulkGenError("Sélectionne au moins un contact pour générer l'email.");
      return;
    }
    if (hubspotContacts.length + manualSelected.length > 100) {
      setBulkGenError("Maximum 100 contacts.");
      return;
    }

    // Build contacts array: HubSpot contacts + manual emails as minimal entries
    const contacts = [
      ...hubspotContacts.map((c) => ({
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        industry: c.industry,
        lifecyclestage: c.lifecyclestage,
      })),
      ...manualSelected.map((m) => ({
        firstName: m.firstName,
        lastName: "",
        company: "",
        industry: "",
        lifecyclestage: "",
      })),
    ];

    setBulkGenerating(true);
    setBulkGenError(null);
    setBulkSubject("");
    setBulkBody("");
    setBulkSendResult(null);
    try {
      const r = await fetch("/api/prospection/generate-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts,
          instructions: bulkInstructions,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setBulkSubject(data.subject ?? "");
      setBulkBody(data.body ?? "");
    } catch (e) {
      setBulkGenError(e instanceof Error ? e.message : "Erreur de génération");
    } finally {
      setBulkGenerating(false);
    }
  };

  const bulkSend = async () => {
    if (!bulkSubject || !bulkBody) return;
    // All selected contacts from results + cache (pinned) + manual
    const allSelected: { email: string; firstName: string }[] = [];
    for (const id of bulkSelectedIds) {
      const contact = bulkContactsCache.get(id);
      if (contact?.email) allSelected.push({ email: contact.email, firstName: contact.firstName });
    }
    for (const m of bulkManualEmails) {
      if (bulkSelectedIds.has(m.id)) allSelected.push({ email: m.email, firstName: m.firstName });
    }
    if (!allSelected.length) return;
    setBulkSending(true);
    setBulkSendResult(null);
    try {
      const r = await fetch("/api/gmail/send-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: allSelected, subject: bulkSubject, body: bulkBody }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setBulkSendResult(data);
    } catch (e) {
      setBulkSendResult({ sent: 0, failed: allSelected.length, errors: [e instanceof Error ? e.message : "Erreur"] });
    } finally {
      setBulkSending(false);
    }
  };

  const addManualEmail = () => {
    const email = bulkManualInput.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const id = `manual-${email}`;
    if (bulkManualEmails.some((m) => m.id === id)) return;
    const entry = { id, email, firstName: "" };
    setBulkManualEmails((prev) => [...prev, entry]);
    setBulkSelectedIds((prev) => new Set([...prev, id]));
    setBulkManualInput("");
  };

  const bulkSelectedCount = bulkSelectedIds.size;
  const bulkOverLimit = bulkSelectedCount > 100;
  const bulkFirstSelectedContact =
    [...bulkSelectedIds].map((id) => bulkContactsCache.get(id) ?? bulkManualEmails.find((m) => m.id === id)).find(Boolean);
  const bulkFirstSelected = bulkFirstSelectedContact as (SearchResult | { firstName: string } | undefined);

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
          {/* Mode toggle */}
          <div className="flex rounded-lg border overflow-hidden shrink-0" style={{ borderColor: "#e5e5e5" }}>
            {(["individual", "bulk"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="text-xs px-3 py-1.5 transition-colors"
                style={{
                  background: mode === m ? "#111" : "#fff",
                  color: mode === m ? "#fff" : "#888",
                }}
              >
                {m === "individual" ? "Individuel" : "Masse"}
              </button>
            ))}
          </div>
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

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">

      {mode === "individual" && (<>

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

                {/* Search bar */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && search()}
                    placeholder="Nom, email, entreprise — ou demande à l'IA…"
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none transition-all"
                    style={{ borderColor: "#e5e5e5", color: "#111", background: "#fff" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
                  />
                  <button
                    onClick={search}
                    disabled={searching}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-opacity"
                    style={{
                      background: searching && isAiSearch ? "#7c3aed" : "#f01563",
                      color: "#fff",
                      opacity: searching ? 0.7 : 1,
                    }}
                  >
                    {searching ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : searchQuery.trim() ? (
                      <Sparkles size={14} />
                    ) : (
                      <Search size={14} />
                    )}
                    {searching && isAiSearch ? "IA…" : "Rechercher"}
                  </button>
                </div>

                {/* AI status message */}
                {searching && isAiSearch && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: "#7c3aed" }}>
                    <Loader2 size={11} className="animate-spin" />
                    L&apos;IA analyse ta demande et cherche dans HubSpot…
                  </p>
                )}

                {/* Filters */}
                <div className="space-y-2">
                  {/* Row 1: basic filters */}
                  <div className="flex items-center gap-2 flex-wrap">
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

                    <button
                      onClick={() => setShowAdvancedFilters((v) => !v)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                      style={{
                        borderColor: showAdvancedFilters ? "#f01563" : "#e5e5e5",
                        color: showAdvancedFilters ? "#f01563" : "#888",
                        background: showAdvancedFilters ? "#fff0f5" : "#fff",
                      }}
                    >
                      Filtres <ChevronDown size={10} style={{ transform: showAdvancedFilters ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                    </button>

                    {(filterLifecycle || filterIndustry || filterCountry || filterLeadStatus || filterContacted || filterCompanySize || filterSource) && (
                      <button
                        onClick={() => { setFilterLifecycle(""); setFilterIndustry(""); setFilterCountry(""); setFilterLeadStatus(""); setFilterContacted(""); setFilterCompanySize(""); setFilterSource(""); setFilterSort(""); }}
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

                  {/* Row 2: advanced filters */}
                  {showAdvancedFilters && (
                    <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl" style={{ background: "#f9f9f9", border: "1px solid #f0f0f0" }}>
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
                        <option value="lt30">Il y a moins de 30j</option>
                        <option value="30to90">Entre 30 et 90j</option>
                        <option value="gt90">Plus de 90j</option>
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

                      <FilterSelect value={filterSort} onChange={setFilterSort} label="Trier par">
                        <option value="recent">Modifié récemment</option>
                        <option value="lastcontact">Dernier contact</option>
                        <option value="alpha">Alphabétique</option>
                      </FilterSelect>
                    </div>
                  )}
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
                        <button
                          key={r.id}
                          onClick={() => selectContact(r)}
                          className="flex flex-col gap-2 p-3 rounded-xl border text-left transition-all"
                          style={{ borderColor: "#e5e5e5", background: "#fff" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "#f01563";
                            e.currentTarget.style.background = "#fff8fb";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "#e5e5e5";
                            e.currentTarget.style.background = "#fff";
                          }}
                        >
                          {/* Avatar + name */}
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ background: "#f01563", color: "#fff" }}
                            >
                              {((r.firstName?.[0] ?? "") + (r.lastName?.[0] ?? "") || "?").toUpperCase().slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate leading-tight" style={{ color: "#111" }}>
                                {r.firstName} {r.lastName}
                              </p>
                              {r.jobTitle && (
                                <p className="text-[10px] truncate leading-tight" style={{ color: "#888" }}>
                                  {r.jobTitle}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Company */}
                          {r.company && (
                            <p className="text-[11px] font-medium truncate" style={{ color: "#555" }}>
                              {r.company}
                              {r.city ? <span style={{ color: "#bbb" }}> · {r.city}</span> : null}
                            </p>
                          )}

                          {/* Email */}
                          {r.email && (
                            <p className="text-[10px] truncate" style={{ color: "#aaa" }}>{r.email}</p>
                          )}

                          {/* Bottom row */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {r.lifecyclestage && <LifecycleBadge stage={r.lifecyclestage} />}
                            {r.industry && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#f5f5f5", color: "#999" }}>
                                {r.industry}
                              </span>
                            )}
                            {r.lastContacted && (
                              <span className="text-[10px] ml-auto" style={{ color: "#bbb" }}>
                                {new Date(r.lastContacted).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                              </span>
                            )}
                          </div>
                        </button>
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
                {loadingDetails ? (
                  <div className="flex items-center gap-3 py-8 justify-center">
                    <Loader2 size={18} className="animate-spin" style={{ color: "#f01563" }} />
                    <span className="text-sm" style={{ color: "#888" }}>Chargement des données HubSpot…</span>
                  </div>
                ) : selectedContact && (
                  <>
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
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Email" value={selectedContact.email} readonly />
                        <Field label="Secteur" value={contactIndustry} onChange={setContactIndustry} placeholder="ex: Technology" />
                        {selectedContact.lifecyclestage && (
                          <Field label="Lifecycle" value={selectedContact.lifecyclestage} readonly />
                        )}
                        {selectedContact.leadStatus && (
                          <Field label="Statut lead" value={selectedContact.leadStatus} readonly />
                        )}
                      </div>
                      {selectedContact.crmSummary && (
                        <div className="mt-2">
                          <Field label="Historique CRM" value={selectedContact.crmSummary} readonly multiline />
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
                  onClick={resetAgent}
                  className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg border transition-colors"
                  style={{ borderColor: "#e5e5e5", color: "#555" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  <RotateCcw size={12} />
                  Nouveau prospect
                </button>
              </div>
            )}
          </div>
        </div>

      </>)}

      {/* ── BULK MODE ────────────────────────────────────────────────────────── */}
      {mode === "bulk" && (<>

        {/* LEFT: Contact list with checkboxes */}
        <div className="w-1/2 border-r flex flex-col overflow-hidden" style={{ borderColor: "#f0f0f0" }}>
          <div className="flex flex-col gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: "#f0f0f0", background: "#fff" }}>
            {/* Search + filters */}
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: "#e5e5e5" }}>
                <Search size={13} style={{ color: "#ccc" }} />
                <input
                  value={bulkSearchQuery}
                  onChange={(e) => setBulkSearchQuery(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && bulkSearch()}
                  placeholder="Rechercher dans HubSpot…"
                  className="flex-1 outline-none text-xs bg-transparent"
                  style={{ color: "#111" }}
                />
              </div>
              <button
                onClick={bulkSearch}
                disabled={bulkSearching}
                className="px-3 py-2 rounded-lg text-xs font-medium transition-opacity"
                style={{ background: "#111", color: "#fff", opacity: bulkSearching ? 0.5 : 1 }}
              >
                {bulkSearching ? <Loader2 size={13} className="animate-spin" /> : "OK"}
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <FilterSelect value={bulkFilterLifecycle} onChange={setBulkFilterLifecycle} label="Lifecycle">
                <option value="subscriber">Abonné</option>
                <option value="lead">Lead</option>
                <option value="marketingqualifiedlead">MQL</option>
                <option value="salesqualifiedlead">SQL</option>
                <option value="opportunity">Opportunité</option>
                <option value="customer">Client</option>
              </FilterSelect>
              <FilterSelect value={bulkFilterIndustry} onChange={setBulkFilterIndustry} label="Secteur">
                {[...new Set(bulkResults.map((r) => r.industry).filter(Boolean))].sort().map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </FilterSelect>
              <button
                onClick={() => setShowBulkAdvancedFilters((v) => !v)}
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors"
                style={{
                  borderColor: showBulkAdvancedFilters ? "#f01563" : "#e5e5e5",
                  color: showBulkAdvancedFilters ? "#f01563" : "#888",
                  background: showBulkAdvancedFilters ? "#fff0f5" : "#fff",
                }}
              >
                Filtres <ChevronDown size={10} style={{ transform: showBulkAdvancedFilters ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {(bulkFilterLifecycle || bulkFilterIndustry || bulkSearchQuery || bulkFilterCountry || bulkFilterLeadStatus || bulkFilterContacted || bulkFilterCompanySize || bulkFilterSource) && (
                <button
                  onClick={() => { setBulkSearchQuery(""); setBulkFilterLifecycle(""); setBulkFilterIndustry(""); setBulkFilterCountry(""); setBulkFilterLeadStatus(""); setBulkFilterContacted(""); setBulkFilterCompanySize(""); setBulkFilterSource(""); setBulkFilterSort(""); setBulkResults([]); setBulkNextCursor(null); setBulkSelectedIds(new Set()); }}
                  className="px-2 py-1.5 rounded-lg text-xs transition-colors"
                  style={{ color: "#aaa", border: "1px solid #e5e5e5" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f01563")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#aaa")}
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
            {/* Advanced bulk filters */}
            {showBulkAdvancedFilters && (
              <div className="flex gap-2 flex-wrap p-2.5 rounded-xl" style={{ background: "#f9f9f9", border: "1px solid #f0f0f0" }}>
                <FilterSelect value={bulkFilterCountry} onChange={setBulkFilterCountry} label="Pays">
                  {[...new Set(bulkResults.map((r) => r.country).filter(Boolean))].sort().map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </FilterSelect>
                <FilterSelect value={bulkFilterLeadStatus} onChange={setBulkFilterLeadStatus} label="Statut lead">
                  <option value="NEW">Nouveau</option>
                  <option value="OPEN">Ouvert</option>
                  <option value="IN_PROGRESS">En cours</option>
                  <option value="ATTEMPTED_TO_CONTACT">Contacté</option>
                  <option value="CONNECTED">Connecté</option>
                  <option value="BAD_TIMING">Mauvais timing</option>
                  <option value="UNQUALIFIED">Non qualifié</option>
                </FilterSelect>
                <FilterSelect value={bulkFilterContacted} onChange={setBulkFilterContacted} label="Dernier contact">
                  <option value="never">Jamais contacté</option>
                  <option value="lt30">Il y a moins de 30j</option>
                  <option value="30to90">Entre 30 et 90j</option>
                  <option value="gt90">Plus de 90j</option>
                </FilterSelect>
                <FilterSelect value={bulkFilterCompanySize} onChange={setBulkFilterCompanySize} label="Taille">
                  <option value="1-10">1 – 10</option>
                  <option value="11-50">11 – 50</option>
                  <option value="51-200">51 – 200</option>
                  <option value="201-1000">201 – 1000</option>
                  <option value="1000+">+ 1000</option>
                </FilterSelect>
                <FilterSelect value={bulkFilterSource} onChange={setBulkFilterSource} label="Source">
                  <option value="ORGANIC_SEARCH">Recherche organique</option>
                  <option value="DIRECT_TRAFFIC">Trafic direct</option>
                  <option value="EMAIL_MARKETING">Email marketing</option>
                  <option value="PAID_SEARCH">Recherche payante</option>
                  <option value="REFERRALS">Référence</option>
                  <option value="SOCIAL_MEDIA">Réseaux sociaux</option>
                  <option value="OFFLINE">Hors ligne</option>
                  <option value="OTHER">Autre</option>
                </FilterSelect>
                <FilterSelect value={bulkFilterSort} onChange={setBulkFilterSort} label="Trier par">
                  <option value="recent">Modifié récemment</option>
                  <option value="lastcontact">Dernier contact</option>
                  <option value="alpha">Alphabétique</option>
                </FilterSelect>
              </div>
            )}
            {/* Select all row */}
            {bulkResults.length > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkResults.every((r) => bulkSelectedIds.has(r.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setBulkSelectedIds(new Set(bulkResults.map((r) => r.id)));
                    } else {
                      setBulkSelectedIds(new Set());
                    }
                  }}
                  className="w-3.5 h-3.5 accent-pink-600"
                />
                <span className="text-xs" style={{ color: "#888" }}>
                  Tout sélectionner
                  {bulkSelectedCount > 0 && (
                    <span className="ml-2 font-medium" style={{ color: bulkOverLimit ? "#ef4444" : "#f01563" }}>
                      · {bulkSelectedCount} sélectionné{bulkSelectedCount > 1 ? "s" : ""}
                      {bulkOverLimit && " (max 100)"}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {bulkSearching && bulkResults.length === 0 && (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin" style={{ color: "#f01563" }} />
              </div>
            )}

            {/* Pinned: selected contacts not in current results */}
            {(() => {
              const pinned = [...bulkSelectedIds]
                .filter((id) => !id.startsWith("manual-") && !bulkResults.some((r) => r.id === id))
                .map((id) => bulkContactsCache.get(id))
                .filter(Boolean) as SearchResult[];
              const pinnedManual = bulkManualEmails.filter((m) => bulkSelectedIds.has(m.id));
              if (pinned.length === 0 && pinnedManual.length === 0) return null;
              return (
                <>
                  <div className="px-4 py-1.5 border-b" style={{ borderColor: "#f5f5f5", background: "#fdf2f8" }}>
                    <span className="text-[10px] font-semibold" style={{ color: "#f01563" }}>
                      SÉLECTIONNÉS · {pinned.length + pinnedManual.length}
                    </span>
                  </div>
                  {pinned.map((r) => (
                    <label key={r.id} className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer" style={{ borderColor: "#f5f5f5", background: "#fff8fb" }}>
                      <input type="checkbox" checked onChange={(e) => { if (!e.target.checked) setBulkSelectedIds((prev) => { const next = new Set(prev); next.delete(r.id); return next; }); }} className="w-3.5 h-3.5 shrink-0 accent-pink-600" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: "#111" }}>{r.firstName} {r.lastName}</p>
                        <p className="text-[11px] truncate" style={{ color: "#888" }}>{[r.company, r.jobTitle].filter(Boolean).join(" · ")}</p>
                      </div>
                      {r.lifecyclestage && <LifecycleBadge stage={r.lifecyclestage} />}
                    </label>
                  ))}
                  {pinnedManual.map((m) => (
                    <label key={m.id} className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer" style={{ borderColor: "#f5f5f5", background: "#fff8fb" }}>
                      <input type="checkbox" checked onChange={(e) => { if (!e.target.checked) setBulkSelectedIds((prev) => { const next = new Set(prev); next.delete(m.id); return next; }); }} className="w-3.5 h-3.5 shrink-0 accent-pink-600" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: "#111" }}>{m.email}</p>
                        <p className="text-[10px]" style={{ color: "#aaa" }}>Email manuel</p>
                      </div>
                    </label>
                  ))}
                  {bulkResults.length > 0 && (
                    <div className="px-4 py-1.5 border-b" style={{ borderColor: "#f5f5f5", background: "#f9f9f9" }}>
                      <span className="text-[10px] font-semibold" style={{ color: "#bbb" }}>RÉSULTATS</span>
                    </div>
                  )}
                </>
              );
            })()}

            {bulkResults.map((r) => {
              const checked = bulkSelectedIds.has(r.id);
              const hasEmail = !!r.email;
              return (
                <label
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: "#f5f5f5",
                    background: checked ? "#fff8fb" : "transparent",
                    opacity: hasEmail ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={!hasEmail}
                    checked={checked}
                    onChange={(e) => {
                      setBulkSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 shrink-0 accent-pink-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "#111" }}>
                      {r.firstName} {r.lastName}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: "#888" }}>
                      {[r.company, r.jobTitle].filter(Boolean).join(" · ")}
                    </p>
                    {!hasEmail && <p className="text-[10px]" style={{ color: "#f01563" }}>Pas d&apos;email</p>}
                  </div>
                  {r.lifecyclestage && <LifecycleBadge stage={r.lifecyclestage} />}
                </label>
              );
            })}
            {bulkLoadingMore && (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin" style={{ color: "#f01563" }} />
              </div>
            )}
            <div ref={bulkSentinelRef} className="h-1" />
          </div>

          {/* Manual email add */}
          <div className="flex gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: "#f0f0f0", background: "#fff" }}>
            <input
              value={bulkManualInput}
              onChange={(e) => setBulkManualInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && addManualEmail()}
              placeholder="Ajouter un email manuellement…"
              className="flex-1 text-xs outline-none"
              style={{ color: "#111" }}
            />
            <button
              onClick={addManualEmail}
              className="text-xs px-2 py-1 rounded-lg transition-colors"
              style={{ background: "#f5f5f5", color: "#555" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fde8ef")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#f5f5f5")}
            >
              + Ajouter
            </button>
          </div>
        </div>

        {/* RIGHT: Generation + preview + send */}
        <div className="w-1/2 flex flex-col overflow-y-auto p-5 gap-4" style={{ background: "#fafafa" }}>

          {bulkOverLimit && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fff0f3", color: "#f01563", border: "1px solid #fecdd3" }}>
              Sélection limitée à 100 contacts maximum. Déselectionne des contacts pour continuer.
            </div>
          )}

          {/* Instructions */}
          <div className="rounded-xl border p-4 bg-white" style={{ borderColor: "#e5e5e5" }}>
            <p className="text-xs font-semibold mb-3" style={{ color: "#111" }}>Instructions pour Claude</p>
            <textarea
              value={bulkInstructions}
              onChange={(e) => setBulkInstructions(e.target.value)}
              placeholder="Ex : Email court et direct, axé sur la performance des équipes, évite de parler de prix…"
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-xs outline-none resize-none transition-all"
              style={{ borderColor: "#e5e5e5", color: "#111", background: "#fff" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#f01563")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e5")}
            />
          </div>

          {/* Generate button */}
          <button
            onClick={bulkGenerate}
            disabled={bulkSelectedCount === 0 || bulkOverLimit || bulkGenerating}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity"
            style={{ background: "#111", color: "#fff", opacity: bulkSelectedCount > 0 && !bulkOverLimit && !bulkGenerating ? 1 : 0.4 }}
          >
            {bulkGenerating ? (
              <><Loader2 size={15} className="animate-spin" /> Génération en cours…</>
            ) : (
              <><Sparkles size={15} /> Générer pour {bulkSelectedCount || "…"} contact{bulkSelectedCount > 1 ? "s" : ""}</>
            )}
          </button>

          {bulkGenError && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fff0f3", color: "#f01563" }}>
              {bulkGenError}
            </p>
          )}

          {/* Preview */}
          {(bulkSubject || bulkBody) && (
            <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: "#e5e5e5" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "#f0f0f0" }}>
                <p className="text-[11px] font-medium mb-1" style={{ color: "#888" }}>OBJET</p>
                <input
                  value={bulkSubject}
                  onChange={(e) => setBulkSubject(e.target.value)}
                  className="w-full text-sm font-medium outline-none bg-transparent"
                  style={{ color: "#111" }}
                />
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] font-medium mb-2" style={{ color: "#888" }}>APERÇU (tel que reçu)</p>
                {/* Greeting preview */}
                <p className="text-xs mb-2" style={{ color: "#aaa", fontStyle: "italic" }}>
                  Bonjour {bulkFirstSelected?.firstName || "[Prénom]"},
                </p>
                <textarea
                  value={bulkBody}
                  onChange={(e) => setBulkBody(e.target.value)}
                  rows={10}
                  className="w-full text-sm outline-none resize-none bg-transparent leading-relaxed"
                  style={{ color: "#111" }}
                />
              </div>
            </div>
          )}

          {/* Send button */}
          {(bulkSubject || bulkBody) && (
            <button
              onClick={bulkSend}
              disabled={bulkSelectedCount === 0 || bulkOverLimit || !bulkSubject || !bulkBody || bulkSending || gmailConnected === false}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity"
              style={{ background: "#f01563", color: "#fff", opacity: bulkSelectedCount > 0 && !bulkOverLimit && bulkSubject && bulkBody && !bulkSending && gmailConnected !== false ? 1 : 0.4 }}
            >
              {bulkSending ? (
                <><Loader2 size={15} className="animate-spin" /> Envoi en cours…</>
              ) : (
                <><Send size={15} /> Envoyer à {bulkResults.filter((r) => bulkSelectedIds.has(r.id) && r.email).length} contact{bulkSelectedCount > 1 ? "s" : ""}</>
              )}
            </button>
          )}

          {bulkSendResult && (
            <div
              className="px-4 py-3 rounded-xl text-xs space-y-1"
              style={{
                background: bulkSendResult.failed === 0 ? "#f0fdf4" : "#fff8f0",
                border: `1px solid ${bulkSendResult.failed === 0 ? "#bbf7d0" : "#ffe4c4"}`,
                color: bulkSendResult.failed === 0 ? "#15803d" : "#c2410c",
              }}
            >
              <p className="font-semibold">
                {bulkSendResult.sent} envoyé{bulkSendResult.sent > 1 ? "s" : ""}
                {bulkSendResult.failed > 0 && `, ${bulkSendResult.failed} échoué${bulkSendResult.failed > 1 ? "s" : ""}`}
              </p>
              {bulkSendResult.errors.map((e, i) => (
                <p key={i} className="truncate" style={{ color: "#ef4444" }}>{e}</p>
              ))}
            </div>
          )}
        </div>

      </>)}

      </div>
    </div>
  );
}
