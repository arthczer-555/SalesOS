"use client";

// Panneau Apollo : préréglages persona, filtres, recherche gratuite paginée.
// Les emails ne sont révélés qu'après confirmation (job apollo_reveal).
import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search, SlidersHorizontal, Sparkles, UserCheck } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { TagInput } from "@/components/ui/tag-input";
import { COMPANY_SIZE_OPTIONS, SENIORITY_OPTIONS } from "@/lib/prospecting/personas";
import {
  EMPTY_APOLLO_FILTERS,
  apolloProspectToLead,
  hasApolloFilter,
  personaToApolloFilters,
  type ApolloFilters,
  type ApolloProspect,
} from "@/lib/prospecting/sources/shared";
import { useProspectingPersonas } from "@/lib/hooks/use-prospecting-personas";
import { useApolloSearch } from "@/lib/hooks/use-prospecting-sources";
import { bindTableSelection, dedupeByKey, makeSelected, type SelectedLead, type SelectionApi } from "./selection";
import { Card, ChipToggle, Eyebrow, PanelHeader, PersonCell, TableFrame, formatCount, modKey } from "./ui";

export interface ApolloPrefill {
  filters: ApolloFilters;
  /** Change à chaque demande pour relancer la recherche même avec les mêmes filtres. */
  token: number;
  label?: string;
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function displayName(p: ApolloProspect): string {
  const last = p.lastName ?? p.lastNameMasked ?? "";
  return `${p.firstName} ${last}`.trim() || "Unknown";
}

function toSelected(p: ApolloProspect): SelectedLead {
  const partial = p.name_is_partial && !p.lastName;
  return makeSelected(apolloProspectToLead(p), "apollo", {
    label: displayName(p),
    note: partial ? "Name revealed with email" : undefined,
  });
}

export function ApolloPanel({
  selection,
  personaId,
  prefill,
  active,
}: {
  selection: SelectionApi;
  personaId: string | null;
  prefill: ApolloPrefill | null;
  active: boolean;
}) {
  const { personas, isLoading: personasLoading, error: personasError } = useProspectingPersonas();
  const apollo = useApolloSearch();
  const [filters, setFilters] = React.useState<ApolloFilters>(EMPTY_APOLLO_FILTERS);
  const [activePersona, setActivePersona] = React.useState<string | null>(null);
  const [showMore, setShowMore] = React.useState(false);
  const [contextLabel, setContextLabel] = React.useState<string | null>(null);
  const presetDone = React.useRef(false);
  const lastPrefill = React.useRef<number | null>(null);

  const patch = (p: Partial<ApolloFilters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setActivePersona(null);
  };

  const { search } = apollo;
  const run = React.useCallback(
    (f: ApolloFilters, page = 1) => {
      if (!hasApolloFilter(f)) return;
      void search(f, page);
    },
    [search],
  );

  // Préréglage depuis le persona de la campagne (une fois), recherche lancée
  // d'office : elle est gratuite.
  React.useEffect(() => {
    if (presetDone.current || prefill || personasLoading || !active) return;
    presetDone.current = true;
    const p = personas.find((x) => x.id === personaId);
    if (!p) return;
    const f = personaToApolloFilters(p);
    setFilters(f);
    setActivePersona(p.id);
    run(f);
  }, [personas, personasLoading, personaId, prefill, active, run]);

  // "Find people here with Apollo" depuis la Watch List.
  React.useEffect(() => {
    if (!prefill || lastPrefill.current === prefill.token) return;
    lastPrefill.current = prefill.token;
    presetDone.current = true;
    setFilters(prefill.filters);
    setActivePersona(null);
    setContextLabel(prefill.label ?? null);
    setShowMore(prefill.filters.domains.length > 0 || !!prefill.filters.organizationName);
    run(prefill.filters);
  }, [prefill, run]);

  const applyPersona = (id: string) => {
    const p = personas.find((x) => x.id === id);
    if (!p) return;
    const f = personaToApolloFilters(p);
    setFilters(f);
    setActivePersona(id);
    setContextLabel(null);
    run(f);
  };

  const titleSuggestions = React.useMemo(() => Array.from(new Set(personas.flatMap((p) => p.targeting.titles))).slice(0, 60), [personas]);

  const data = apollo.data;
  const rows = React.useMemo(() => dedupeByKey((data?.people ?? []).map(toSelected)), [data]);
  const byKey = React.useMemo(() => new Map((data?.people ?? []).map((p) => [toSelected(p).key, p])), [data]);
  const bound = bindTableSelection(rows, selection);

  const canSearch = hasApolloFilter(filters);
  // Ctrl/Cmd + Entrée dans les filtres = Search. Le TagInput ajoute d'abord le
  // titre en cours de saisie : on lit les filtres après ce rendu (ref synchronisée
  // en layout effect), d'où le setTimeout.
  const filtersRef = React.useRef(filters);
  React.useLayoutEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  const onFiltersKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => run(filtersRef.current), 0);
    }
  };

  const columns: Column<SelectedLead>[] = [
    {
      key: "person",
      header: "Person",
      render: (r) => {
        const p = byKey.get(r.key);
        return (
          <PersonCell
            name={r.label ?? ""}
            sub={p?.location ?? undefined}
            note={r.note}
            badges={
              p?.alreadyKnown ? (
                <Tag
                  tone="info"
                  size="sm"
                  icon={UserCheck}
                  title={p.alreadyKnown.email ? "Already in your team's prospect base with an email: no credit needed." : "Already in your team's prospect base."}
                >
                  Already known
                </Tag>
              ) : null
            }
          />
        );
      },
    },
    {
      key: "title",
      header: "Title",
      render: (r) => {
        const p = byKey.get(r.key);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: COLORS.ink1, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p?.title ?? ""}>
              {p?.title ?? "-"}
            </div>
            {p?.seniority ? <div style={{ fontSize: 11, color: COLORS.ink3, textTransform: "capitalize" }}>{p.seniority.replace(/_/g, " ")}</div> : null}
          </div>
        );
      },
    },
    {
      key: "company",
      header: "Company",
      render: (r) => {
        const p = byKey.get(r.key);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink1, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p?.companyName ?? "-"}
            </div>
            {p?.companyDomain ? <div style={{ fontSize: 11, color: COLORS.ink3 }}>{p.companyDomain}</div> : null}
          </div>
        );
      },
    },
    {
      key: "email",
      header: "Email",
      width: 110,
      render: (r) => {
        const p = byKey.get(r.key);
        if (p?.alreadyKnown?.email) return <Tag tone="ok" size="sm" dot title={p.alreadyKnown.email}>Known</Tag>;
        if (p?.hasEmail === true) return <Tag tone="ok" size="sm">Available</Tag>;
        if (p?.hasEmail === false) return <Tag tone="neutral" size="sm" title="Apollo has no email on file for this person.">Unlikely</Tag>;
        return <span style={{ fontSize: 12, color: COLORS.ink4 }}>-</span>;
      },
    },
  ];

  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const perPage = data?.perPage ?? 25;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);

  return (
    <div>
      <PanelHeader
        icon={Sparkles}
        title="Find new people with Apollo"
        description="Search Apollo's database by role, seniority, company and location. Pick a persona to start from your ideal customer profile."
      />

      {/* Préréglages persona */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Eyebrow style={{ marginRight: 2 }}>Start from</Eyebrow>
        {personasLoading ? (
          <>
            <Skeleton width={120} height={26} radius={999} />
            <Skeleton width={140} height={26} radius={999} />
          </>
        ) : personasError ? (
          <span style={{ fontSize: 12, color: COLORS.err }}>Personas could not be loaded.</span>
        ) : (
          personas.map((p) => (
            <ChipToggle key={p.id} active={activePersona === p.id} color={p.color} onClick={() => applyPersona(p.id)} title={p.description}>
              {p.name}
            </ChipToggle>
          ))
        )}
      </div>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }} onKeyDown={onFiltersKeyDown}>
          {contextLabel ? (
            <Banner tone="neutral" style={{ padding: "8px 10px" }}>
              {contextLabel}
            </Banner>
          ) : null}
          <Field label="Job titles" hint="Similar titles are included. Press Enter to add each title.">
            <TagInput
              value={filters.titles}
              onChange={(v) => patch({ titles: v })}
              placeholder="e.g. Head of Sales, VP Sales, CHRO"
              suggestions={titleSuggestions}
            />
          </Field>
          <Field label="Seniority">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SENIORITY_OPTIONS.map((s) => (
                <ChipToggle key={s.value} active={filters.seniorities.includes(s.value)} onClick={() => patch({ seniorities: toggle(filters.seniorities, s.value) })}>
                  {s.label}
                </ChipToggle>
              ))}
            </div>
          </Field>
          <Field label="Company size (employees)">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {COMPANY_SIZE_OPTIONS.map((s) => (
                <ChipToggle key={s} active={filters.companySizes.includes(s)} onClick={() => patch({ companySizes: toggle(filters.companySizes, s) })}>
                  {s}
                </ChipToggle>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Person location">
              <TagInput value={filters.locations} onChange={(v) => patch({ locations: v })} placeholder="e.g. France, London" size="sm" />
            </Field>
            <Field label="Company domains">
              <TagInput value={filters.domains} onChange={(v) => patch({ domains: v, organizationName: undefined })} placeholder="e.g. acme.com" size="sm" />
            </Field>
          </div>
          {showMore ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="ds-rise">
              <Field label="Company HQ location">
                <TagInput value={filters.organizationLocations} onChange={(v) => patch({ organizationLocations: v })} placeholder="e.g. Germany" size="sm" />
              </Field>
              <Field label="Industry keywords">
                <TagInput value={filters.industryKeywords} onChange={(v) => patch({ industryKeywords: v })} placeholder="e.g. SaaS, fintech" size="sm" />
              </Field>
              <Field label="Keywords" style={{ gridColumn: "1 / -1" }}>
                <Input
                  size="sm"
                  value={filters.keywords}
                  onChange={(e) => patch({ keywords: e.target.value })}
                  placeholder="Any keyword (skills, technologies, company name...)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      run(filters);
                    }
                  }}
                />
              </Field>
              {filters.organizationName && !filters.domains.length ? (
                <div style={{ gridColumn: "1 / -1", fontSize: 12, color: COLORS.ink2 }}>
                  Company name: <strong>{filters.organizationName}</strong>{" "}
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => patch({ organizationName: undefined })}>
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button variant="ghost" size="sm" icon={SlidersHorizontal} iconRight={ChevronDown} onClick={() => setShowMore((v) => !v)}>
              {showMore ? "Fewer filters" : "More filters"}
            </Button>
            <div style={{ flex: 1 }} />
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => {
                setFilters(EMPTY_APOLLO_FILTERS);
                setActivePersona(null);
                setContextLabel(null);
                apollo.reset();
              }}
            >
              Reset
            </Button>
            <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }} aria-hidden>
              <Kbd>{modKey()}</Kbd>
              <Kbd>Enter</Kbd>
            </span>
            <Button variant="primary" icon={Search} loading={apollo.isLoading} disabled={!canSearch} onClick={() => run(filters)} title="Search (Ctrl or Cmd + Enter in the filters)">
              Search
            </Button>
          </div>
        </div>
      </Card>

      <Banner tone="info" style={{ marginBottom: 12 }}>
        <strong>Search is free.</strong> Emails are revealed after you confirm (1 credit per person). We check HubSpot first, so people your team already knows cost nothing.
      </Banner>

      {!apollo.configured ? (
        <Banner tone="warn" title="Apollo is not configured">
          {apollo.error ?? "Ask an admin to add the Apollo API key."} You can still add prospects from HubSpot, a file or by hand.
        </Banner>
      ) : apollo.error ? (
        <Banner
          tone="err"
          title="Apollo search failed"
          action={
            <Button size="sm" icon={RotateCcw} onClick={apollo.retry}>
              Retry
            </Button>
          }
        >
          {apollo.error}
        </Banner>
      ) : !data && !apollo.isLoading ? (
        <Card padding={0}>
          <EmptyState
            icon={Search}
            title="Find people with Apollo"
            description="Pick a persona or set filters, then press Search."
          />
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
              {apollo.isLoading && !data ? "Searching..." : `${formatCount(total)} ${total === 1 ? "person matches" : "people match"}`}
            </div>
            {data && total > 0 ? (
              <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                Showing {formatCount(from)} to {formatCount(to)}
              </div>
            ) : null}
            <div style={{ flex: 1 }} />
            {data && pages > 1 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Button size="sm" icon={ChevronLeft} disabled={page <= 1 || apollo.isLoading} onClick={() => run(filters, page - 1)} aria-label="Previous page" />
                <span style={{ fontSize: 12, color: COLORS.ink2, fontVariantNumeric: "tabular-nums" }}>
                  Page {page} of {formatCount(Math.min(pages, 500))}
                </span>
                <Button size="sm" icon={ChevronRight} disabled={page >= Math.min(pages, 500) || apollo.isLoading} onClick={() => run(filters, page + 1)} aria-label="Next page" />
              </div>
            ) : null}
          </div>
          <TableFrame>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              loading={apollo.isLoading}
              selectable
              selected={bound.selected}
              onSelectedChange={bound.onSelectedChange}
              skeletonRows={8}
              empty={
                <EmptyState
                  icon={Search}
                  title="No one matches these filters"
                  description="Broaden the job titles, remove a seniority or a company size, then search again."
                />
              }
            />
          </TableFrame>
        </>
      )}
    </div>
  );
}
