"use client";

import { useState, useEffect } from "react";
import { Search, RefreshCw, Send, Zap, X, Plus, Globe, Info, Phone, Mail, Building2, Calendar } from "lucide-react";

interface MarketSignal {
  id: string;
  company_name: string;
  signal_type: string;
  title: string;
  summary: string | null;
  source_url: string | null;
  signal_date: string | null;
  strength: number;
  created_at: string;
}

// HubSpot contact
interface HsContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
}

// Web-found contact (Tavily + Claude, or Claude knowledge fallback)
interface WebContact {
  name: string;
  title: string;
  linkedin_url: string | null;
  source_url: string;
  source?: "web" | "ai";
}

// Unified contact for the composer
interface SelectedContact {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
  source: "hubspot" | "web";
  linkedin_url?: string | null;
  crmSummary?: string;
}

interface ContactDetails {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: string;
  industry: string;
  city: string;
  country: string;
  lifecyclestage: string;
  leadStatus: string;
  lastContacted: string | null;
  lastActivity: string | null;
  createdAt: string | null;
  deals: { id: string; name: string; stage: string; amount: string | null; closedate: string | null }[];
  engagements: { type: string; date: string; body: string | null; subject: string | null; duration: number | null; status: string | null }[];
}

interface CompanyContext {
  description: string;
  keyFacts: string[];
  hubspotDeal: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  funding: "Levée",
  hiring: "Recrutement",
  nomination: "Nomination",
  expansion: "Expansion",
  restructuring: "Restructuration",
  content: "Publication",
};


const TYPE_COLORS: Record<string, { background: string; color: string }> = {
  funding: { background: "#fef3c7", color: "#92400e" },
  hiring: { background: "#dbeafe", color: "#1e40af" },
  nomination: { background: "#f3e8ff", color: "#6b21a8" },
  expansion: { background: "#dcfce7", color: "#14532d" },
  restructuring: { background: "#fee2e2", color: "#991b1b" },
  content: { background: "#f1f5f9", color: "#475569" },
};

const TONES = [
  { value: "cold", label: "Cold outreach" },
  { value: "warm", label: "Warm intro" },
  { value: "followup", label: "Follow-up" },
  { value: "signal", label: "Signal-based" },
];

const TONE_INSTRUCTIONS: Record<string, string> = {
  cold: "C'est un premier contact. Sois direct, concis, et crée de la curiosité. Pas de flatterie inutile.",
  warm: "Tu as une connexion commune ou un contexte chaleureux. Sois naturel et personnel.",
  followup: "C'est un suivi d'un contact précédent. Rappelle brièvement le contexte et propose une prochaine étape.",
  signal:
    "Tu te bases sur un signal récent (levée, nomination, recrutement) pour personnaliser au maximum. Cite le signal explicitement dans l'email.",
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [filterType, setFilterType] = useState("all");
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [activeSignal, setActiveSignal] = useState<MarketSignal | null>(null);

  // Scan global
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Analyse entreprise spécifique
  const [showModal, setShowModal] = useState(false);
  const [analyzeCompany, setAnalyzeCompany] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  // Center panel
  const [query, setQuery] = useState("");
  const [hsContacts, setHsContacts] = useState<HsContact[]>([]);
  const [webContacts, setWebContacts] = useState<WebContact[]>([]);
  const [webFallback, setWebFallback] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchingWeb, setSearchingWeb] = useState(false);
  const [companyContext, setCompanyContext] = useState<CompanyContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // Contact details modal
  const [contactDetails, setContactDetails] = useState<ContactDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Composer
  const [selectedContact, setSelectedContact] = useState<SelectedContact | null>(null);
  const [tone, setTone] = useState("cold");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    loadSignals();
  }, []);

  async function loadSignals() {
    setLoadingSignals(true);
    try {
      const res = await fetch("/api/market/signals");
      if (res.ok) setSignals(await res.json());
    } finally {
      setLoadingSignals(false);
    }
  }

  async function scanMarket() {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/market/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setScanResult(
        data.signals > 0
          ? `${data.signals} signal(s) trouvé(s) sur ${data.companies} entreprise(s)`
          : data.debug === "tavily_empty"
          ? `Tavily vide — ${data.errors?.[0] ?? "clé API ?"}`
          : data.debug === "claude_no_json"
          ? `Claude sans JSON (${data.sources} sources)`
          : data.debug === "claude_empty"
          ? `Aucune entreprise nommée (${data.sources} sources)`
          : data.debug === "json_parse_error"
          ? "Réponse Claude malformée"
          : data.debug === "db_error"
          ? `Erreur DB : ${data.message}`
          : data.debug === "server_error"
          ? `Erreur serveur : ${data.message}`
          : "Aucun signal détecté"
      );
      await loadSignals();
    } catch (e) {
      setScanResult(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function analyzeCompanySignals() {
    if (!analyzeCompany.trim()) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const res = await fetch("/api/market/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: analyzeCompany }),
      });
      const data = await res.json();
      setAnalyzeResult(`${data.signals ?? 0} signal(s) trouvé(s) pour ${analyzeCompany}`);
      await loadSignals();
    } catch {
      setAnalyzeResult("Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  }

  async function searchHubSpot(q: string) {
    if (!q.trim()) { setHsContacts([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/prospection/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setHsContacts(data.results ?? []);
      } else {
        setHsContacts([]);
      }
    } catch {
      setHsContacts([]);
    } finally {
      setSearching(false);
    }
  }

  async function searchWeb(company: string) {
    setSearchingWeb(true);
    setWebContacts([]);
    setWebFallback(false);
    try {
      const res = await fetch(`/api/market/contacts-web?company=${encodeURIComponent(company)}`);
      if (res.ok) {
        const data = await res.json();
        setWebContacts(data.contacts ?? []);
        setWebFallback(data.fallback === true);
      } else {
        setWebContacts([]);
      }
    } catch {
      setWebContacts([]);
    } finally {
      setSearchingWeb(false);
    }
  }

  async function loadCompanyContext(company: string) {
    setLoadingContext(true);
    setCompanyContext(null);
    try {
      const res = await fetch("/api/market/company-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.description !== undefined) setCompanyContext(data);
      }
    } catch {
      // non-critical, ignore
    } finally {
      setLoadingContext(false);
    }
  }

  async function openContactDetails(id: string) {
    setLoadingDetails(true);
    setContactDetails(null);
    try {
      const res = await fetch(`/api/market/contact-details?id=${id}`);
      if (res.ok) setContactDetails(await res.json());
    } catch {
      // ignore
    } finally {
      setLoadingDetails(false);
    }
  }

  function handleProspect(signal: MarketSignal) {
    setActiveSignal(signal);
    setQuery(signal.company_name);
    setHsContacts([]);
    setWebContacts([]);
    searchHubSpot(signal.company_name);
    loadCompanyContext(signal.company_name);
  }

  function selectHsContact(c: HsContact) {
    setSelectedContact({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      jobTitle: c.jobTitle,
      company: c.company,
      industry: c.industry,
      lifecyclestage: c.lifecyclestage,
      source: "hubspot",
    });
  }

  function selectWebContact(c: WebContact, company: string) {
    const [firstName, ...rest] = c.name.split(" ");
    setSelectedContact({
      firstName: firstName ?? c.name,
      lastName: rest.join(" "),
      email: "",
      jobTitle: c.title,
      company,
      industry: "",
      lifecyclestage: "",
      source: "web",
      linkedin_url: c.linkedin_url,
    });
  }

  async function generateEmail() {
    if (!selectedContact) return;
    setGenerating(true);
    try {
      const contextText = companyContext
        ? `${companyContext.description}\n${companyContext.keyFacts.join("\n")}`
        : undefined;
      const signalText = activeSignal
        ? `Signal détecté : ${activeSignal.title} — ${activeSignal.summary ?? ""}`
        : undefined;

      const res = await fetch("/api/prospection/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactInfo: {
            firstName: selectedContact.firstName,
            lastName: selectedContact.lastName,
            email: selectedContact.email,
            jobTitle: selectedContact.jobTitle,
            company: selectedContact.company,
            industry: selectedContact.industry,
            lifecyclestage: selectedContact.lifecyclestage,
            crmSummary: selectedContact.crmSummary ?? "",
          },
          recentNews: signalText,
          companyContext: contextText,
          userInstructions: TONE_INSTRUCTIONS[tone],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSubject(data.subject ?? "");
        setBody(data.body ?? "");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function sendEmail() {
    if (!selectedContact?.email || !subject || !body) return;
    setSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedContact.email, subject, body }),
      });
      if (res.ok) {
        setSentOk(true);
        setTimeout(() => setSentOk(false), 3000);
      }
    } finally {
      setSending(false);
    }
  }

  const filteredSignals =
    filterType === "all" ? signals : signals.filter((s) => s.signal_type === filterType);

  const todayStr = new Date().toDateString();

  const lastScanDate = signals.length > 0
    ? new Date(Math.max(...signals.map((s) => new Date(s.created_at).getTime())))
    : null;
  const lastScanLabel = lastScanDate
    ? lastScanDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const isSelected = (key: string) =>
    selectedContact ? `${selectedContact.firstName} ${selectedContact.lastName}` === key : false;

  const showCenter = !!activeSignal;
  const showComposer = !!selectedContact;

  const leftWidth = showComposer ? "30%" : showCenter ? "50%" : "100%";
  const centerWidth = showComposer ? "30%" : showCenter ? "50%" : "0%";
  const rightWidth = showComposer ? "40%" : "0%";

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#f8f8f8" }}>
      {/* ── LEFT: Signal Feed ──────────────────────────────────────────────── */}
      <div
        className="flex flex-col border-r"
        style={{ width: leftWidth, flexShrink: 0, background: "#fff", borderColor: "#eee", transition: "width 0.3s ease", overflow: "hidden" }}
      >
        <div className="px-4 py-4 border-b" style={{ borderColor: "#eee" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: "#111" }}>Market Intel</h2>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border"
              style={{ background: "#fff", color: "#555", borderColor: "#e5e5e5" }}
              title="Analyser une entreprise spécifique"
            >
              <Plus size={12} />
            </button>
          </div>

          <button
            onClick={scanMarket}
            disabled={scanning}
            className="flex items-center justify-center gap-1.5 w-full text-xs py-2 rounded-lg mb-3 transition-colors disabled:opacity-60"
            style={{ background: "#f01563", color: "#fff" }}
          >
            <Globe size={12} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scan en cours..." : "Scan global du marché"}
          </button>
          {scanResult && (
            <p
              className="text-[10px] mb-2 text-center"
              style={{ color: scanResult.includes("signal(s) trouvé") ? "#16a34a" : "#888" }}
            >
              {scanResult}
            </p>
          )}
          {!scanResult && lastScanLabel && (
            <p className="text-[10px] mb-2 text-center" style={{ color: "#bbb" }}>
              Dernière recherche le {lastScanLabel}
            </p>
          )}

          <div className="flex flex-wrap gap-1">
            {["all", "funding", "hiring", "nomination", "expansion", "restructuring"].map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className="text-xs px-2 py-0.5 rounded-full transition-colors"
                style={
                  filterType === t
                    ? { background: "#f01563", color: "#fff" }
                    : { background: "#f5f5f5", color: "#888" }
                }
              >
                {t === "all" ? "Tous" : TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loadingSignals ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-xs" style={{ color: "#aaa" }}>Chargement...</span>
            </div>
          ) : filteredSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 px-4 text-center">
              <span className="text-2xl">📡</span>
              <p className="text-xs" style={{ color: "#aaa" }}>
                Aucun signal. Cliquez sur &ldquo;Scan global&rdquo; ou &ldquo;+&rdquo; pour analyser une entreprise.
              </p>
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${showComposer ? 2 : showCenter ? 3 : 5}, minmax(0, 1fr))` }}
            >
              {filteredSignals.map((signal) => {
                const isActive = activeSignal?.id === signal.id;
                const colors = TYPE_COLORS[signal.signal_type] ?? TYPE_COLORS.content;
                const isNew = new Date(signal.created_at).toDateString() === todayStr;

                return (
                  <div
                    key={signal.id}
                    className="flex flex-col rounded-xl border p-3 cursor-default"
                    style={{
                      borderColor: isActive ? "#f9b4cb" : "#ebebeb",
                      background: isActive ? "#fde8ef" : "#fff",
                      transition: "box-shadow 0.15s ease, border-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)"; e.currentTarget.style.borderColor = "#ddd"; } }}
                    onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "#ebebeb"; } }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-semibold truncate flex-1" style={{ color: "#111" }}>
                        {signal.company_name}
                      </span>
                      {isNew && (
                        <span className="text-[9px] px-1 rounded-full font-medium shrink-0" style={{ background: "#fde8ef", color: "#f01563" }}>
                          NEW
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] mb-2 line-clamp-2 flex-1" style={{ color: "#666", lineHeight: "1.4" }}>
                      {signal.title}
                    </p>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={colors}>
                        {TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {signal.source_url && (
                          <a
                            href={signal.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] underline underline-offset-2"
                            style={{ color: "#aaa" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Source
                          </a>
                        )}
                        <div className="flex gap-0.5">
                          {[1, 2, 3].map((n) => (
                            <div key={n} className="w-1.5 h-1.5 rounded-full" style={{ background: n <= signal.strength ? "#f01563" : "#e5e5e5" }} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleProspect(signal)}
                      className="text-[10px] py-1.5 rounded-lg w-full text-center transition-colors"
                      style={{ background: "#f5f5f5", color: "#555" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f01563"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#f5f5f5"; e.currentTarget.style.color = "#555"; }}
                    >
                      Prospecter →
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── CENTER: Contacts & Context ─────────────────────────────────────── */}
      <div className="flex flex-col relative" style={{ width: centerWidth, flexShrink: 0, overflow: "hidden", transition: "width 0.3s ease" }}>
        {/* Background icon */}
        {!searching && !searchingWeb && !loadingContext && !companyContext && hsContacts.length === 0 && webContacts.length === 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: "url('/icon.png')",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center center",
              backgroundSize: "600px 600px",
              opacity: 0.10,
            }}
          />
        )}
        {activeSignal && (
          <div
            className="flex items-center gap-2 px-4 py-2 text-xs border-b"
            style={{ background: "#fde8ef", borderColor: "#f9b4cb", color: "#c01252" }}
          >
            <Zap size={12} />
            <span>
              Signal actif : <strong>{activeSignal.company_name}</strong> — {activeSignal.title}
            </span>
            <button
              className="ml-auto"
              onClick={() => {
                setActiveSignal(null);
                setCompanyContext(null);
                setHsContacts([]);
                setWebContacts([]);
                setQuery("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Manual search */}
        <div className="px-4 py-3 border-b" style={{ borderColor: "#eee", background: "#fff" }}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#aaa" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  searchHubSpot(query);
                  searchWeb(query);
                }
              }}
              placeholder="Rechercher une entreprise ou un contact... (Entrée)"
              className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg outline-none"
              style={{ borderColor: "#e5e5e5", color: "#111" }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ position: "relative", zIndex: 1 }}>
          {/* Company context */}
          {(loadingContext || companyContext) && (
            <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: "#111" }}>Contexte entreprise</h3>
              {loadingContext ? (
                <p className="text-xs" style={{ color: "#aaa" }}>Analyse en cours...</p>
              ) : companyContext ? (
                <>
                  <p className="text-xs mb-2" style={{ color: "#555" }}>{companyContext.description}</p>
                  <ul className="space-y-1 mb-2">
                    {companyContext.keyFacts.map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs" style={{ color: "#444" }}>
                        <span style={{ color: "#f01563" }}>•</span>{f}
                      </li>
                    ))}
                  </ul>
                  {companyContext.hubspotDeal && (
                    <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: "#f0fdf4", color: "#166534" }}>
                      Deal HubSpot : {companyContext.hubspotDeal}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* HubSpot contacts */}
          {(searching || hsContacts.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#aaa" }}>HubSpot</span>
                {searching && <span className="text-[10px]" style={{ color: "#aaa" }}>Recherche...</span>}
                {!searching && <span className="text-[10px]" style={{ color: "#aaa" }}>{hsContacts.length} contact(s)</span>}
              </div>
              {!searching && hsContacts.length === 0 && (
                <p className="text-xs" style={{ color: "#aaa" }}>Aucun contact HubSpot trouvé</p>
              )}
              <div className="space-y-2">
                {hsContacts.map((c) => {
                  const key = `${c.firstName} ${c.lastName}`;
                  const active = isSelected(key);
                  return (
                    <ContactCard
                      key={c.id}
                      initials={(c.firstName?.[0] ?? "") + (c.lastName?.[0] ?? "")}
                      name={`${c.firstName} ${c.lastName}`}
                      subtitle={`${c.jobTitle}${c.company ? ` · ${c.company}` : ""}`}
                      detail={c.email}
                      badge="HubSpot"
                      badgeColor={{ background: "#f0fdf4", color: "#166534" }}
                      active={active}
                      onSelect={() => selectHsContact(c)}
                      onInfo={() => openContactDetails(c.id)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Web search trigger */}
          {!searchingWeb && webContacts.length === 0 && query && (
            <button
              onClick={() => searchWeb(query)}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border transition-colors"
              style={{ borderColor: "#e5e5e5", color: "#555", background: "#fafafa" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fafafa"; }}
            >
              <Globe size={12} />
              Chercher sur le web
            </button>
          )}

          {/* Web contacts */}
          {(searchingWeb || webContacts.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#aaa" }}>
                  {webFallback ? "IA (Tavily indisponible)" : "Web"}
                </span>
                {searchingWeb && <span className="text-[10px]" style={{ color: "#aaa" }}>Recherche...</span>}
                {!searchingWeb && <span className="text-[10px]" style={{ color: "#aaa" }}>{webContacts.length} contact(s)</span>}
                {webFallback && !searchingWeb && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>
                    Estimation
                  </span>
                )}
              </div>
              {!searchingWeb && webContacts.length === 0 && (
                <p className="text-xs" style={{ color: "#aaa" }}>Aucun contact trouvé sur le web</p>
              )}
              <div className="space-y-2">
                {webContacts.map((c, i) => {
                  const active = isSelected(c.name);
                  return (
                    <ContactCard
                      key={i}
                      initials={c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                      name={c.name}
                      subtitle={c.title}
                      detail={c.linkedin_url ? "LinkedIn disponible" : "Pas d'email (contact web)"}
                      badge={c.source === "ai" ? "IA" : "Web"}
                      badgeColor={c.source === "ai"
                        ? { background: "#fef3c7", color: "#92400e" }
                        : { background: "#eff6ff", color: "#1d4ed8" }}
                      active={active}
                      onSelect={() => selectWebContact(c, activeSignal?.company_name ?? query)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!searching && !searchingWeb && !loadingContext && !companyContext && hsContacts.length === 0 && webContacts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <span className="text-3xl"></span>
              <p className="text-m" style={{ color: "#f30000" }}>
                
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: AI Composer ─────────────────────────────────────────────── */}
      <div
        className="flex flex-col border-l"
        style={{ width: rightWidth, flexShrink: 0, background: "#fff", borderColor: "#eee", transition: "width 0.3s ease", overflow: "hidden" }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "#eee" }}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold" style={{ color: "#111" }}>Composeur IA</h2>
              {selectedContact ? (
                <p className="text-xs mt-0.5 truncate" style={{ color: "#888" }}>
                  → {selectedContact.firstName} {selectedContact.lastName}
                  {selectedContact.company ? ` · ${selectedContact.company}` : ""}
                </p>
              ) : (
                <p className="text-xs mt-0.5" style={{ color: "#aaa" }}>Sélectionnez un contact</p>
              )}
            </div>
            {selectedContact && (
              <button
                onClick={() => { setSelectedContact(null); setSubject(""); setBody(""); }}
                className="ml-2 mt-0.5 rounded p-0.5"
                style={{ color: "#aaa" }}
                title="Retirer le contact"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Context tags */}
          {(activeSignal || selectedContact) && (
            <div className="flex flex-wrap gap-1">
              {activeSignal && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#fde8ef", color: "#c01252" }}>
                  {activeSignal.company_name}
                </span>
              )}
              {activeSignal && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#f3f4f6", color: "#6b7280" }}>
                  {TYPE_LABELS[activeSignal.signal_type] ?? activeSignal.signal_type}
                </span>
              )}
              {selectedContact && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#dbeafe", color: "#1e40af" }}>
                  {selectedContact.firstName} {selectedContact.lastName}
                </span>
              )}
              {selectedContact?.source === "web" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>
                  Pas d&apos;email
                </span>
              )}
            </div>
          )}

          {/* Tone selector */}
          <div>
            <p className="text-xs font-medium mb-1.5" style={{ color: "#555" }}>Ton</p>
            <div className="grid grid-cols-2 gap-1">
              {TONES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTone(t.value)}
                  className="text-xs py-1.5 rounded-lg border transition-colors"
                  style={
                    tone === t.value
                      ? { background: "#fde8ef", color: "#f01563", borderColor: "#f9b4cb" }
                      : { background: "transparent", color: "#888", borderColor: "#e5e5e5" }
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "#555" }}>Objet</p>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet de l'email..."
              className="w-full text-xs px-3 py-2 border rounded-lg outline-none"
              style={{ borderColor: "#e5e5e5", color: "#111" }}
            />
          </div>

          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "#555" }}>Message</p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                selectedContact
                  ? "Cliquez sur 'Générer' pour rédiger l'email..."
                  : "Sélectionnez un contact via 'Rédiger →'"
              }
              rows={11}
              className="w-full text-xs px-3 py-2 border rounded-lg outline-none resize-none"
              style={{ borderColor: "#e5e5e5", color: "#111", lineHeight: "1.6" }}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t" style={{ borderColor: "#eee" }}>
          <div className="flex gap-2">
            <button
              onClick={generateEmail}
              disabled={!selectedContact || generating}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: "#f5f5f5", color: "#333" }}
              onMouseEnter={(e) => { if (!generating && selectedContact) e.currentTarget.style.background = "#eee"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
            >
              <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
              {generating ? "Génération..." : "Générer"}
            </button>
            <button
              onClick={sendEmail}
              disabled={!selectedContact?.email || !subject || !body || sending}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: sentOk ? "#dcfce7" : "#f01563", color: sentOk ? "#166534" : "#fff" }}
              title={!selectedContact?.email ? "Email non disponible pour ce contact" : undefined}
            >
              <Send size={12} />
              {sending ? "Envoi..." : sentOk ? "Envoyé !" : "Envoyer"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Contact Details Modal ─────────────────────────────────────────── */}
      {(loadingDetails || contactDetails) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setContactDetails(null); }}
        >
          <div className="h-full overflow-y-auto flex flex-col shadow-2xl" style={{ width: 440, background: "#fff" }}>

            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: "#eee" }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-bold shrink-0 uppercase"
                    style={{ background: "#fde8ef", color: "#f01563" }}
                  >
                    {contactDetails
                      ? (contactDetails.firstName?.[0] ?? "") + (contactDetails.lastName?.[0] ?? "")
                      : "…"}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "#111" }}>
                      {contactDetails ? `${contactDetails.firstName} ${contactDetails.lastName}` : "Chargement..."}
                    </h3>
                    {contactDetails && (
                      <p className="text-xs mt-0.5" style={{ color: "#888" }}>
                        {contactDetails.jobTitle}{contactDetails.company ? ` · ${contactDetails.company}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => setContactDetails(null)}>
                  <X size={16} style={{ color: "#aaa" }} />
                </button>
              </div>

              {contactDetails && (
                <button
                  className="w-full text-xs py-2 rounded-xl font-medium transition-colors"
                  style={{ background: "#f01563", color: "#fff" }}
                  onClick={() => {
                    const crmSummary = contactDetails.engagements.length > 0
                      ? contactDetails.engagements.slice(0, 8).map((e) => {
                          const date = new Date(e.date).toLocaleDateString("fr-FR");
                          const lines = [
                            `[${engagementLabel(e.type)} — ${date}${e.duration ? ` — ${e.duration} min` : ""}]`,
                            e.subject ? `Objet : ${e.subject}` : null,
                            e.body ? e.body : null,
                          ].filter(Boolean).join("\n");
                          return lines;
                        }).join("\n\n")
                      : "";
                    setSelectedContact({
                      firstName: contactDetails.firstName,
                      lastName: contactDetails.lastName,
                      email: contactDetails.email,
                      jobTitle: contactDetails.jobTitle,
                      company: contactDetails.company,
                      industry: contactDetails.industry,
                      lifecyclestage: contactDetails.lifecyclestage,
                      source: "hubspot",
                      crmSummary,
                    });
                    setContactDetails(null);
                  }}
                >
                  Rédiger → pour ce contact
                </button>
              )}
            </div>

            {loadingDetails ? (
              <div className="flex items-center justify-center flex-1 py-12">
                <p className="text-xs" style={{ color: "#aaa" }}>Chargement du contact...</p>
              </div>
            ) : contactDetails ? (
              <div className="flex-1 px-5 py-4 space-y-5">

                {/* Contact info */}
                <div className="rounded-xl p-3 space-y-2.5" style={{ background: "#fafafa", border: "1px solid #f0f0f0" }}>
                  {contactDetails.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={12} style={{ color: "#aaa" }} />
                      <a href={`mailto:${contactDetails.email}`} className="text-xs hover:underline" style={{ color: "#555" }}>
                        {contactDetails.email}
                      </a>
                    </div>
                  )}
                  {contactDetails.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} style={{ color: "#aaa" }} />
                      <a href={`tel:${contactDetails.phone}`} className="text-xs" style={{ color: "#555" }}>
                        {contactDetails.phone}
                      </a>
                    </div>
                  )}
                  {(contactDetails.city || contactDetails.country) && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: "#555" }}>
                      <Building2 size={12} style={{ color: "#aaa" }} />
                      {[contactDetails.city, contactDetails.country].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {contactDetails.lastContacted && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: "#555" }}>
                      <Calendar size={12} style={{ color: "#aaa" }} />
                      Dernier contact : {new Date(Number(contactDetails.lastContacted)).toLocaleDateString("fr-FR")}
                    </div>
                  )}
                </div>

                {/* CRM badges */}
                {(contactDetails.lifecyclestage || contactDetails.leadStatus || contactDetails.industry) && (
                  <div className="flex gap-1.5 flex-wrap">
                    {contactDetails.lifecyclestage && (
                      <span className="text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
                        {contactDetails.lifecyclestage}
                      </span>
                    )}
                    {contactDetails.leadStatus && (
                      <span className="text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}>
                        {contactDetails.leadStatus}
                      </span>
                    )}
                    {contactDetails.industry && (
                      <span className="text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                        {contactDetails.industry}
                      </span>
                    )}
                  </div>
                )}

                {/* Deals */}
                {contactDetails.deals.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2" style={{ color: "#111" }}>
                      Deals associés ({contactDetails.deals.length})
                    </p>
                    <div className="space-y-2">
                      {contactDetails.deals.map((d) => (
                        <div key={d.id} className="p-3 rounded-xl" style={{ border: "1px solid #e5e5e5", borderLeft: "3px solid #f01563" }}>
                          <p className="text-xs font-medium mb-1.5" style={{ color: "#111" }}>{d.name}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#dbeafe", color: "#1e40af" }}>
                              {d.stage}
                            </span>
                            {d.amount && (
                              <span className="text-xs font-semibold" style={{ color: "#f01563" }}>
                                {Number(d.amount).toLocaleString("fr-FR")} €
                              </span>
                            )}
                            {d.closedate && (
                              <span className="text-[10px]" style={{ color: "#aaa" }}>
                                Closing : {new Date(d.closedate).toLocaleDateString("fr-FR")}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Engagement timeline */}
                <div>
                  <p className="text-xs font-semibold mb-3" style={{ color: "#111" }}>
                    Historique ({contactDetails.engagements.length})
                  </p>
                  {contactDetails.engagements.length === 0 ? (
                    <p className="text-xs" style={{ color: "#aaa" }}>Aucun historique trouvé</p>
                  ) : (
                    <div>
                      {contactDetails.engagements.map((e, i) => (
                        <div key={i} className="flex gap-3 pb-4">
                          <div className="flex flex-col items-center">
                            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: engagementStyle(e.type).color }} />
                            {i < contactDetails.engagements.length - 1 && (
                              <div className="w-px flex-1 mt-1" style={{ background: "#e5e5e5" }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 pb-0.5">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={engagementStyle(e.type)}>
                                {engagementLabel(e.type)}
                              </span>
                              <span className="text-[10px]" style={{ color: "#aaa" }}>
                                {new Date(e.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                              {e.duration !== null && (
                                <span className="text-[10px]" style={{ color: "#aaa" }}>{e.duration} min</span>
                              )}
                            </div>
                            {e.subject && (
                              <p className="text-xs font-medium mb-0.5" style={{ color: "#333" }}>{e.subject}</p>
                            )}
                            {e.body && (
                              <p className="text-xs leading-relaxed" style={{ color: "#777", whiteSpace: "pre-wrap" }}>{e.body}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Analyze Modal ──────────────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowModal(false); setAnalyzeResult(null); setAnalyzeCompany(""); } }}
        >
          <div className="rounded-2xl p-6 shadow-2xl" style={{ background: "#fff", width: 400 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Analyser une entreprise</h3>
              <button onClick={() => { setShowModal(false); setAnalyzeResult(null); setAnalyzeCompany(""); }}>
                <X size={16} style={{ color: "#aaa" }} />
              </button>
            </div>
            <p className="text-xs mb-3" style={{ color: "#888" }}>
              Tavily recherche les actualités des 30 derniers jours et Claude détecte les signaux d&apos;achat pour Coachello.
            </p>
            <input
              type="text"
              value={analyzeCompany}
              onChange={(e) => setAnalyzeCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeCompanySignals()}
              placeholder="Nom de l'entreprise (ex : Doctrine.ai)"
              className="w-full text-sm px-3 py-2 border rounded-lg outline-none mb-3"
              style={{ borderColor: "#e5e5e5", color: "#111" }}
              autoFocus
            />
            {analyzeResult && (
              <p className="text-xs mb-3" style={{ color: analyzeResult.startsWith("Erreur") ? "#dc2626" : "#16a34a" }}>
                {analyzeResult}
              </p>
            )}
            <button
              onClick={analyzeCompanySignals}
              disabled={!analyzeCompany.trim() || analyzing}
              className="w-full text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: "#f01563", color: "#fff" }}
            >
              {analyzing ? "Analyse en cours..." : "Analyser"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared contact card component ──────────────────────────────────────────
function ContactCard({
  initials, name, subtitle, detail, badge, badgeColor, active, onSelect, onInfo,
}: {
  initials: string;
  name: string;
  subtitle: string;
  detail: string;
  badge: string;
  badgeColor: { background: string; color: string };
  active: boolean;
  onSelect: () => void;
  onInfo?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
      style={{
        borderColor: active ? "#f01563" : "#e5e5e5",
        background: active ? "#fff9fb" : "#fff",
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 uppercase"
        style={{ background: "#fde8ef", color: "#f01563" }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold truncate" style={{ color: "#111" }}>{name}</p>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={badgeColor}>{badge}</span>
        </div>
        <p className="text-[10px] truncate" style={{ color: "#888" }}>{subtitle}</p>
        <p className="text-[10px] truncate" style={{ color: "#aaa" }}>{detail}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onInfo && (
          <button
            onClick={onInfo}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#aaa" }}
            title="Voir le contexte HubSpot"
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f01563"; e.currentTarget.style.background = "#fde8ef"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.background = "transparent"; }}
          >
            <Info size={13} />
          </button>
        )}
        <button
          onClick={onSelect}
          className="text-[10px] px-2.5 py-1 rounded-lg transition-colors"
          style={active ? { background: "#f01563", color: "#fff" } : { background: "#f5f5f5", color: "#555" }}
          onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "#f01563"; e.currentTarget.style.color = "#fff"; } }}
          onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "#f5f5f5"; e.currentTarget.style.color = "#555"; } }}
        >
          Rédiger →
        </button>
      </div>
    </div>
  );
}

// ── Engagement helpers ──────────────────────────────────────────────────────
function engagementLabel(type: string): string {
  const map: Record<string, string> = {
    NOTE: "Note",
    EMAIL: "Email",
    CALL: "Appel",
    MEETING: "Réunion",
    TASK: "Tâche",
  };
  return map[type] ?? type;
}

function engagementStyle(type: string): { background: string; color: string } {
  const map: Record<string, { background: string; color: string }> = {
    NOTE: { background: "#fef3c7", color: "#92400e" },
    EMAIL: { background: "#dbeafe", color: "#1e40af" },
    CALL: { background: "#dcfce7", color: "#14532d" },
    MEETING: { background: "#f3e8ff", color: "#6b21a8" },
    TASK: { background: "#f1f5f9", color: "#475569" },
  };
  return map[type] ?? { background: "#f1f5f9", color: "#475569" };
}
