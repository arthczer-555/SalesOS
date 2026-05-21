"use client";

import { useState } from "react";

interface TestResult {
  label: string;
  credits: number;
  loading: boolean;
  data: unknown | null;
  error: string | null;
}

interface HsContact {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  jobtitle: string;
  company: string;
}

export default function LinkedInTestPage() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [profileInput, setProfileInput] = useState("williamhgates");
  const [emailInput, setEmailInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("coaching managers");
  const [companyInput, setCompanyInput] = useState("totalenergies");
  const [radarCompany, setRadarCompany] = useState("totalenergies");
  const [searchCompany, setSearchCompany] = useState("TotalEnergies");
  const [searchTitle, setSearchTitle] = useState("Head of L&D");
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [nameCompany, setNameCompany] = useState("");
  const [totalCredits, setTotalCredits] = useState(0);
  const [companyDetailsInput, setCompanyDetailsInput] = useState("totalenergies");
  const [initLimit, setInitLimit] = useState(3);

  // HubSpot contacts
  const [hsContacts, setHsContacts] = useState<HsContact[]>([]);
  const [hsLoading, setHsLoading] = useState(false);
  const [hsLoaded, setHsLoaded] = useState(false);
  const [hsFilter, setHsFilter] = useState("");

  async function runTest(key: string, label: string, credits: number, fetchFn: () => Promise<Response>) {
    setResults((prev) => ({ ...prev, [key]: { label, credits, loading: true, data: null, error: null } }));
    try {
      const res = await fetchFn();
      const data = await res.json();
      setResults((prev) => ({ ...prev, [key]: { label, credits, loading: false, data, error: res.ok ? null : (data.error ?? `HTTP ${res.status}`) } }));
      if (res.ok) setTotalCredits((prev) => prev + credits);
    } catch (e) {
      setResults((prev) => ({ ...prev, [key]: { label, credits, loading: false, data: null, error: String(e) } }));
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "#111" }}>LinkedIn API Test</h1>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          Teste les endpoints Netrows. Chaque test consomme des crédits.
        </p>
        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
          Crédits utilisés cette session : {totalCredits} / 100
        </div>
      </div>

      {/* ── Contacts HubSpot ─────────────────────────────────────────── */}
      <div className="rounded-xl border p-4 mb-6" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#111" }}>Contacts HubSpot</p>
            <p className="text-[11px]" style={{ color: "#888" }}>Charge tes contacts, vois leur poste, et lance une recherche Netrows par entreprise</p>
          </div>
          {!hsLoaded ? (
            <button
              onClick={async () => {
                setHsLoading(true);
                try {
                  const res = await fetch("/api/prospection/search?q=&limit=100");
                  const data = await res.json();
                  setHsContacts((data.results ?? []).map((c: { id: string; properties: Record<string, string> }) => ({
                    id: c.id,
                    firstname: c.properties?.firstname ?? "",
                    lastname: c.properties?.lastname ?? "",
                    email: c.properties?.email ?? "",
                    jobtitle: c.properties?.jobtitle ?? "",
                    company: c.properties?.company ?? "",
                  })).filter((c: HsContact) => c.company && c.jobtitle));
                  setHsLoaded(true);
                } catch { /* ignore */ }
                setHsLoading(false);
              }}
              disabled={hsLoading}
              className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
              style={{ background: "#111", color: "#fff" }}
            >
              {hsLoading ? "Chargement…" : "Charger 100 contacts"}
            </button>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#f0fdf4", color: "#16a34a" }}>
              {hsContacts.length} contacts chargés
            </span>
          )}
        </div>

        {hsLoaded && (
          <>
            <input
              value={hsFilter}
              onChange={(e) => setHsFilter(e.target.value)}
              placeholder="Filtrer par nom, poste ou entreprise…"
              className="w-full text-xs px-3 py-1.5 border rounded-lg outline-none mb-3"
              style={{ borderColor: "#e5e5e5" }}
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {hsContacts
                .filter((c) => {
                  if (!hsFilter) return true;
                  const q = hsFilter.toLowerCase();
                  return `${c.firstname} ${c.lastname} ${c.jobtitle} ${c.company}`.toLowerCase().includes(q);
                })
                .slice(0, 30)
                .map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "#111" }}>
                        {contact.firstname} {contact.lastname}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: "#888" }}>
                        {contact.jobtitle} · {contact.company}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {contact.email && !contact.email.includes("gmail") && !contact.email.includes("yahoo") && !contact.email.includes("hotmail") && (
                        <button
                          onClick={() => {
                            setEmailInput(contact.email);
                            runTest(`email_${contact.id}`, `Email ${contact.email}`, 1, () => fetch(`/api/linkedin/profile?email=${contact.email}`));
                          }}
                          className="text-[10px] px-2 py-1 rounded font-medium"
                          style={{ background: "#eff6ff", color: "#2563eb" }}
                        >
                          Email lookup
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSearchCompany(contact.company);
                          setSearchTitle(contact.jobtitle);
                          runTest(`search_${contact.id}`, `${contact.jobtitle} @ ${contact.company}`, 1, () =>
                            fetch(`/api/linkedin/search?company=${encodeURIComponent(contact.company)}&title=${encodeURIComponent(contact.jobtitle)}`)
                          );
                        }}
                        className="text-[10px] px-2 py-1 rounded font-medium"
                        style={{ background: "#f0fdf4", color: "#16a34a" }}
                      >
                        People Search
                      </button>
                      <button
                        onClick={() => {
                          setNameFirst(contact.firstname);
                          setNameLast(contact.lastname);
                          setNameCompany(contact.company);
                          const params = new URLSearchParams();
                          params.set("firstName", contact.firstname);
                          params.set("lastName", contact.lastname);
                          if (contact.company) params.set("company", contact.company);
                          runTest(`name_${contact.id}`, `${contact.firstname} ${contact.lastname}`, 1, () =>
                            fetch(`/api/linkedin/search?${params.toString()}`)
                          );
                        }}
                        className="text-[10px] px-2 py-1 rounded font-medium"
                        style={{ background: "#fef3c7", color: "#92400e" }}
                      >
                        Par nom
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-4">

        {/* ── Profil LinkedIn ──────────────────────────────────────────── */}
        <TestCard title="Profil LinkedIn" description="Récupérer un profil complet par username" credits={1}>
          <div className="flex gap-2">
            <input value={profileInput} onChange={(e) => setProfileInput(e.target.value)} placeholder="username (ex: williamhgates)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("profile", `Profil ${profileInput}`, 1, () => fetch(`/api/linkedin/profile?username=${profileInput}`))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.profile?.loading ? "..." : "Tester (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── People Search (entreprise + titre) ──────────────────────── */}
        <TestCard title="People Search" description="Chercher des personnes par entreprise + titre de poste. Tu peux mettre plusieurs mots-clés dans le champ titre." credits={1}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={searchCompany} onChange={(e) => setSearchCompany(e.target.value)} placeholder="Entreprise (ex: Danone)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
              <input value={searchTitle} onChange={(e) => setSearchTitle(e.target.value)} placeholder="Titre (ex: DRH, Head of People, L&D)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => runTest("people_search", `"${searchTitle}" @ ${searchCompany}`, 1, () => fetch(`/api/linkedin/search?company=${encodeURIComponent(searchCompany)}&title=${encodeURIComponent(searchTitle)}`))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
                {results.people_search?.loading ? "..." : "Par titre (1 crédit)"}
              </button>
              <button onClick={() => runTest("people_search_kw", `keywords "${searchTitle}" @ ${searchCompany}`, 1, () => fetch(`/api/linkedin/search?company=${encodeURIComponent(searchCompany)}&keywords=${encodeURIComponent(searchTitle)}`))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#111", color: "#fff" }}>
                {results.people_search_kw?.loading ? "..." : "Par mots-clés (1 crédit)"}
              </button>
            </div>
          </div>
        </TestCard>

        {/* ── Recherche par nom ─────────────────────────────────────── */}
        <TestCard title="Recherche par Nom" description="Trouver un profil LinkedIn par prénom + nom (+ entreprise optionnel)" credits={1}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={nameFirst} onChange={(e) => setNameFirst(e.target.value)} placeholder="Prénom (ex: Jake)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
              <input value={nameLast} onChange={(e) => setNameLast(e.target.value)} placeholder="Nom (ex: Dotson)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            </div>
            <div className="flex gap-2">
              <input value={nameCompany} onChange={(e) => setNameCompany(e.target.value)} placeholder="Entreprise (optionnel)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
              <button onClick={() => {
                const params = new URLSearchParams();
                if (nameFirst) params.set("firstName", nameFirst);
                if (nameLast) params.set("lastName", nameLast);
                if (nameCompany) params.set("company", nameCompany);
                runTest("name_search", `${nameFirst} ${nameLast}${nameCompany ? ` @ ${nameCompany}` : ""}`, 1, () => fetch(`/api/linkedin/search?${params.toString()}`));
              }} disabled={!nameFirst && !nameLast} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-30" style={{ background: "#f01563", color: "#fff" }}>
                {results.name_search?.loading ? "..." : "Chercher (1 crédit)"}
              </button>
            </div>
          </div>
        </TestCard>

        {/* ── Reverse email lookup ────────────────────────────────────── */}
        <TestCard title="Reverse Email Lookup" description="Trouver un profil LinkedIn à partir d'un email pro" credits={1}>
          <div className="flex gap-2">
            <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="email pro (ex: john@microsoft.com)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("email", `Email ${emailInput}`, 1, () => fetch(`/api/linkedin/profile?email=${emailInput}`))} disabled={!emailInput} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-30" style={{ background: "#f01563", color: "#fff" }}>
              {results.email?.loading ? "..." : "Tester (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── Search posts par keyword ────────────────────────────────── */}
        <TestCard title="Recherche Posts LinkedIn" description="Chercher des posts par mot-clé" credits={1}>
          <div className="flex gap-2">
            <input value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} placeholder="mot-clé (ex: coaching managers)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("posts", `Posts "${keywordInput}"`, 1, () => fetch(`/api/linkedin/scan?mode=test&keyword=${encodeURIComponent(keywordInput)}`, { method: "POST" }))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.posts?.loading ? "..." : "Tester (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── Posts d'une entreprise ───────────────────────────────────── */}
        <TestCard title="Posts Entreprise" description="Récupérer les posts récents d'une page entreprise LinkedIn" credits={1}>
          <div className="flex gap-2">
            <input value={companyInput} onChange={(e) => setCompanyInput(e.target.value)} placeholder="username entreprise (ex: totalenergies)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("company_posts", `Posts ${companyInput}`, 1, () => fetch(`/api/linkedin/scan?mode=test_company&company=${encodeURIComponent(companyInput)}`, { method: "POST" }))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.company_posts?.loading ? "..." : "Tester (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── Radar : lister ──────────────────────────────────────────── */}
        <TestCard title="Radar — Entreprises surveillées" description="Voir les entreprises actuellement dans le Radar" credits={0}>
          <button onClick={() => runTest("radar_list", "Liste Radar", 0, () => fetch("/api/linkedin/setup-radar"))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#111", color: "#fff" }}>
            {results.radar_list?.loading ? "..." : "Lister (gratuit)"}
          </button>
        </TestCard>

        {/* ── Radar : ajouter une entreprise ──────────────────────────── */}
        <TestCard title="Radar — Ajouter une entreprise" description="Ajouter une entreprise au monitoring (1 crédit one-time, puis gratuit)" credits={1}>
          <div className="flex gap-2">
            <input value={radarCompany} onChange={(e) => setRadarCompany(e.target.value)} placeholder="username (ex: totalenergies)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("radar_add", `Radar + ${radarCompany}`, 1, () => fetch("/api/linkedin/setup-radar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companies: [radarCompany] }) }))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.radar_add?.loading ? "..." : "Ajouter (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── Company Details ──────────────────────────────────────────── */}
        <TestCard title="Détails Entreprise" description="Infos LinkedIn d'une entreprise (employés, secteur, siège, description)" credits={1}>
          <div className="flex gap-2">
            <input value={companyDetailsInput} onChange={(e) => setCompanyDetailsInput(e.target.value)} placeholder="username (ex: totalenergies, danone)" className="flex-1 text-xs px-3 py-1.5 border rounded-lg" style={{ borderColor: "#e5e5e5" }} />
            <button onClick={() => runTest("company_details", `Entreprise ${companyDetailsInput}`, 1, () => fetch(`/api/linkedin/company?username=${encodeURIComponent(companyDetailsInput)}`))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.company_details?.loading ? "..." : "Tester (1 crédit)"}
            </button>
          </div>
        </TestCard>

        {/* ── Init Monitoring ─────────────────────────────────────────── */}
        <TestCard title="Init Monitoring" description="Recherche les profils RH/L&D dans les entreprises cibles et les ajoute à la base. Contrôle le nombre d'entreprises." credits={0}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: "#888" }}>Entreprises :</span>
              <input type="number" value={initLimit} onChange={(e) => setInitLimit(Math.max(1, Math.min(20, Number(e.target.value))))} className="w-14 text-xs px-2 py-1.5 border rounded-lg text-center" style={{ borderColor: "#e5e5e5" }} />
            </div>
            <button onClick={() => runTest("init", `Init ${initLimit} entreprises`, initLimit * 3, () => fetch("/api/linkedin/init-monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: initLimit, radarEnabled: false }) }))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
              {results.init?.loading ? "..." : `Lancer (~${initLimit * 3} crédits)`}
            </button>
          </div>
        </TestCard>

        {/* ── Profils monitorés ────────────────────────────────────────── */}
        <TestCard title="Profils Monitorés" description="Liste tous les profils LinkedIn actuellement dans la base de monitoring" credits={0}>
          <button onClick={() => runTest("monitored", "Profils monitorés", 0, () => fetch("/api/linkedin/init-monitoring"))} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#111", color: "#fff" }}>
            {results.monitored?.loading ? "..." : "Lister (gratuit)"}
          </button>
        </TestCard>
      </div>

      {/* ── Résultats ─────────────────────────────────────────────────── */}
      <div className="mt-8 space-y-3">
        <h2 className="text-base font-semibold" style={{ color: "#111" }}>Résultats</h2>
        {Object.entries(results).filter(([, r]) => r.data || r.error).map(([key, r]) => (
          <div key={key} className="rounded-xl border p-4" style={{ borderColor: r.error ? "#fecaca" : "#e5e5e5", background: r.error ? "#fef2f2" : "#fff" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium" style={{ color: "#111" }}>{r.label}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: r.error ? "#fee2e2" : "#f0fdf4", color: r.error ? "#dc2626" : "#16a34a" }}>
                {r.error ? "Erreur" : `OK · ${r.credits} crédit${r.credits > 1 ? "s" : ""}`}
              </span>
            </div>
            {r.error && <p className="text-xs mb-2" style={{ color: "#dc2626" }}>{r.error}</p>}
            <pre className="text-[10px] leading-relaxed overflow-auto max-h-64 p-3 rounded-lg" style={{ background: "#f8f8f8", color: "#555" }}>
              {JSON.stringify(r.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function TestCard({ title, description, credits, children }: { title: string; description: string; credits: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: "#111" }}>{title}</p>
          <p className="text-[11px]" style={{ color: "#888" }}>{description}</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: credits === 0 ? "#f0fdf4" : "#fef3c7", color: credits === 0 ? "#16a34a" : "#92400e" }}>
          {credits === 0 ? "Gratuit" : `${credits} crédit`}
        </span>
      </div>
      {children}
    </div>
  );
}
