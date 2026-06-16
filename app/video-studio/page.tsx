"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { Loader2, Video, Sparkles, Download, Clapperboard, Building2, Info, Clock, AlertTriangle, GraduationCap, X, FileText, LayoutTemplate, Scissors, ImageDown, ArrowRight } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StudioControls, type StudioSelection } from "./studio-controls";
import type { VideoJob } from "@/lib/video/types";

// Le fetcher SWR doit throw sur non-2xx (sinon le body d'erreur devient `data`).
// Voir mémoire [[feedback_swr_fetcher_silent_500]].
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type MatchedClient = { id: string; name: string };

// Débit de narration HeyGen à vitesse 1.0x. ~150 mots/min correspond au repère
// du guide de script (80-150 mots = 30-60 s). La vitesse divise la durée.
const BASE_WPM = 150;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Estime la durée de la vidéo (en secondes) à partir du transcript et de la
// vitesse de lecture. À 1.0x, 150 mots ≈ 60 s ; à 0.85x c'est ~1.18x plus long.
function estimateSeconds(text: string, speed: number): number {
  const words = countWords(text);
  if (words === 0 || speed <= 0) return 0;
  return (words / BASE_WPM) * 60 / speed;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Détection de langue légère pour recommander la bonne vitesse de lecture :
// l'avatar HeyGen rend mieux le FR à 1.0x et l'EN à 0.85x. On compte les marqueurs
// FR (accents + mots-outils) vs EN. Texte vide => EN par défaut (vitesse 0.85x).
function isFrenchText(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  const fr =
    (t.match(/[àâäéèêëîïôöùûüç]/g) || []).length +
    (t.match(/\b(le|la|les|un|une|des|et|est|vous|nous|votre|notre|pour|avec|dans|sur|qui|que|ce|cette)\b/g) || []).length;
  const en =
    (t.match(/\b(the|and|is|are|you|we|your|our|for|with|in|on|that|this|to|of|an)\b/g) || []).length;
  return fr >= en;
}

export default function VideoStudioPage() {
  return (
    <Suspense fallback={null}>
      <VideoStudio />
    </Suspense>
  );
}

function VideoStudio() {
  const searchParams = useSearchParams();
  const forcedClientId = searchParams.get("clientId");

  // Liste des clients (onglet Clients) pour le dropdown de sélection explicite.
  const { data: clientsData } = useSWR<{ clients: { id: string; company_name: string }[] }>(
    "/api/clients/list?owner=all",
    fetcher,
    { revalidateOnFocus: false },
  );
  const clients = clientsData?.clients ?? [];

  // Client choisi explicitement (dropdown) ou présélectionné via lien direct
  // (?clientId=...). "" = aucun, l'IA tente de détecter le client depuis le prompt.
  const [selectedClientId, setSelectedClientId] = useState<string>(forcedClientId ?? "");

  const selectedClient: MatchedClient | null = (() => {
    if (!selectedClientId) return null;
    const c = clients.find((x) => x.id === selectedClientId);
    return c ? { id: c.id, name: c.company_name } : null;
  })();

  const [prompt, setPrompt] = useState("");
  const [script, setScript] = useState("");
  const [speed, setSpeed] = useState(0.85);
  // Choix avatar / langue-voix / fond (StudioControls). Tant que l'utilisateur ne
  // touche à rien, ces valeurs reproduisent la config env (rendu identique).
  const [studio, setStudio] = useState<StudioSelection>({ lang: "auto" });
  const [detected, setDetected] = useState<MatchedClient | null>(null);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [scripting, setScripting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Client effectivement rattaché à la vidéo : sélection explicite (dropdown /
  // lien direct) en priorité, sinon client détecté par Claude depuis le prompt.
  const activeClient = selectedClient ?? detected;

  // Estimation de durée recalculée à chaque édition du transcript ou de la vitesse.
  const wordCount = useMemo(() => countWords(script), [script]);
  const estDuration = useMemo(() => estimateSeconds(script, speed), [script, speed]);

  // Vitesse conseillée selon la langue du transcript : FR -> 1.0x, EN -> 0.85x.
  const isFrench = useMemo(() => isFrenchText(script), [script]);
  const recommendedSpeed = isFrench ? 1.0 : 0.85;
  const speedOffRecommended = Math.abs(speed - recommendedSpeed) > 0.001;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/video-studio");
      const data = (await res.json().catch(() => ({}))) as { jobs?: VideoJob[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll toutes les 10s tant qu'un job est en cours.
  useEffect(() => {
    const hasProcessing = jobs.some((j) => j.status === "processing");
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(() => void load(), 10_000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, load]);

  async function generateScript() {
    setScripting(true);
    setError(null);
    try {
      const res = await fetch("/api/video-studio/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, clientId: selectedClientId || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { script?: string; client?: MatchedClient | null; error?: string };
      if (!res.ok || data.script == null) throw new Error(data.error ?? `HTTP ${res.status}`);
      setScript(data.script);
      setDetected(data.client ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setScripting(false);
    }
  }

  async function generateVideo() {
    setRendering(true);
    setError(null);
    try {
      const res = await fetch("/api/video-studio/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          script,
          speed,
          clientId: activeClient?.id ?? undefined,
          clientName: activeClient?.name ?? undefined,
          avatarId: studio.avatarId,
          avatarType: studio.avatarType,
          voiceId: studio.voiceId,
          lang: studio.lang,
          background: studio.background,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { job?: VideoJob; error?: string };
      if (!res.ok || !data.job) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobs((prev) => [data.job as VideoJob, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setRendering(false);
    }
  }

  const busy = scripting || rendering;

  const promptInvalid = busy || !prompt.trim();
  const scriptInvalid = busy || !script.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <PageHeader
        sticky
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Video size={18} style={{ color: COLORS.brand }} />
            Video Studio
          </span>
        }
        subtitle="Describe the video. Mention a client and the AI pulls its context automatically."
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {jobs.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.ink2,
                  background: COLORS.bgSoft,
                  border: `1px solid ${COLORS.line}`,
                  padding: "3px 10px",
                  borderRadius: 999,
                }}
              >
                {jobs.length} {jobs.length === 1 ? "video" : "videos"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowTutorial(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                padding: "5px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.brand}`,
                background: COLORS.brandTint,
                color: COLORS.brand,
                cursor: "pointer",
              }}
            >
              <GraduationCap size={14} />
              Tutorial: finish your video
            </button>
          </div>
        }
      />

      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div className="vs-studio-grid">
          {/* ───── Left column · Compose ───── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <SectionHeader title="Compose" />

            {error && (
              <div
                style={{
                  fontSize: 13,
                  color: COLORS.err,
                  background: COLORS.errBg,
                  border: `1px solid ${COLORS.err}33`,
                  borderRadius: RADIUS.md,
                  padding: "8px 12px",
                }}
              >
                {error}
              </div>
            )}

            <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <StepTitle index={1} label="Brief" />

              <Field label="Client (optional)">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="">Auto - let the AI do the job (client or not)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: COLORS.ink3 }}>
                  <Info size={12} style={{ flexShrink: 0 }} />
                  Only accounts from the Clients tab are listed here. Pick one to remove any ambiguity, or leave on Auto.
                </div>
              </Field>

              <Field label="Prompt - what the video should present">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="Who is it for, why, and the one key message? e.g. Present our new leadership coaching program to Acme's managers - energetic tone, every manager gets a dedicated coach from day one, invite them to book their first session."
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
              </Field>

              <details style={{ fontSize: 12, color: COLORS.ink2, border: `1px solid ${COLORS.line}`, borderRadius: RADIUS.md, padding: "10px 12px", background: COLORS.bgSoft }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: COLORS.ink1, display: "flex", alignItems: "center", gap: 6 }}>
                  <Info size={13} style={{ flexShrink: 0, color: COLORS.brand }} />
                  How to write a good prompt
                </summary>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, lineHeight: 1.5 }}>
                  <div>A good brief answers 5 things. Skip one and the AI fills the gap generically, so the video falls flat:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                    <li><b>Audience</b> - who is it for? (e.g. enrolled managers, the HR sponsor, employees eligible for coaching)</li>
                    <li><b>Goal</b> - why this video? (present a program, explain how the coaching works, invite to a first session)</li>
                    <li><b>Key message</b> - the single thing to land</li>
                    <li><b>Tone / context</b> - warm and energetic; e.g. a program launch, an onboarding kickoff, a new cohort</li>
                    <li><b>Call to action</b> - one next step (book the first session, log into the app, join the next cohort)</li>
                  </ul>
                  <div style={{ color: COLORS.ink3 }}>
                    <b>Good examples:</b>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                      <li><b>Presenting a coaching program</b> - &quot;Introduce our new leadership coaching program to Acme&apos;s managers. Energetic tone. Key message: every manager gets a dedicated coach and measurable goals from day one. End by inviting them to book their first session.&quot;</li>
                      <li><b>Internal promotion video</b> - &quot;Announce Coachello&apos;s new mentoring track to all employees. Upbeat tone. Key message: anyone can now request a mentor in two clicks. End by pointing them to the sign-up page.&quot;</li>
                    </ul>
                  </div>
                  <div style={{ color: COLORS.ink3 }}>
                    Tip: mention a known client (or pick one above) and the AI pulls its real context - programs, deal, insights.
                  </div>
                </div>
              </details>

              {activeClient && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    alignSelf: "flex-start",
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.brand,
                    background: COLORS.brandTint,
                    padding: "4px 10px",
                    borderRadius: 999,
                  }}
                >
                  <Building2 size={12} />
                  Context: {activeClient.name}
                </div>
              )}

              <button type="button" onClick={() => void generateScript()} disabled={promptInvalid} style={{ ...secondaryBtn(promptInvalid), justifyContent: "center", width: "100%" }}>
                {scripting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {scripting ? "Generating…" : "Propose transcript"}
              </button>
            </Card>

            <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <StepTitle index={2} label="Studio - avatar, voice & background" />
              <StudioControls onChange={setStudio} />
            </Card>

            <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <StepTitle index={3} label="Script" />

              <Field label="Transcript (the avatar reads this, review and edit)">
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={8}
                  placeholder="The proposed transcript will appear here. Edit it before generating the video."
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
                <div style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11, color: COLORS.ink3, lineHeight: 1.45 }}>
                  <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    To make a word sound English, spell it phonetically, e.g. <b>Coachello</b> → <b>kotchélo</b>. The avatar reads the
                    text exactly as written.
                  </span>
                </div>
              </Field>

              <Field label={`Speech speed - ${speed.toFixed(2)}x`}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: COLORS.ink3 }}>0.5x</span>
                  <input
                    type="range"
                    min={0.5}
                    max={1.5}
                    step={0.05}
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    style={{ flex: 1, accentColor: COLORS.brand, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 11, color: COLORS.ink3 }}>1.5x</span>
                  <button
                    type="button"
                    onClick={() => setSpeed(0.85)}
                    style={{ fontSize: 11, color: COLORS.ink2, background: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
                  >
                    Reset
                  </button>
                </div>
              </Field>

              {script.trim() && speedOffRecommended && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.warn,
                    background: COLORS.warnBg,
                    border: `1px solid ${COLORS.warn}33`,
                    borderRadius: 8,
                    padding: "8px 12px",
                  }}
                >
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    {isFrench ? "Mettre la vidéo en x1" : "Set the video to 0.85x"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSpeed(recommendedSpeed)}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#fff",
                      background: COLORS.warn,
                      border: "none",
                      borderRadius: 6,
                      padding: "3px 10px",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {recommendedSpeed === 1 ? "Set 1x" : "Set 0.85x"}
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: COLORS.ink2,
                  background: COLORS.bgSoft,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                <Clock size={14} color={COLORS.ink3} />
                {wordCount > 0 ? (
                  <span>
                    Estimated duration <strong style={{ color: COLORS.ink0 }}>~{formatDuration(estDuration)}</strong>
                    <span style={{ color: COLORS.ink3 }}> · {wordCount} words at {speed.toFixed(2)}x</span>
                  </span>
                ) : (
                  <span style={{ color: COLORS.ink3 }}>Estimated duration appears once the transcript is filled in.</span>
                )}
              </div>

              <button type="button" onClick={() => void generateVideo()} disabled={scriptInvalid} style={{ ...primaryBtn(scriptInvalid), justifyContent: "center", width: "100%" }}>
                {rendering ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />}
                {rendering ? "Submitting…" : "Generate video"}
              </button>
            </Card>
          </div>

          {/* ───── Right column · Library ───── */}
          <div className="vs-library-col" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <SectionHeader
              title="Library"
              right={jobs.length > 0 ? <span style={{ color: COLORS.ink3 }}>{jobs.length}</span> : undefined}
            />

            {jobs.length === 0 ? (
              <Card padding={0}>
                <EmptyState
                  icon={Clapperboard}
                  title="No videos yet"
                  description="Your rendered videos will show up here, next to the composer."
                />
              </Card>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  maxHeight: "calc(100vh - 150px)",
                  overflowY: "auto",
                  paddingRight: 2,
                }}
              >
                {jobs.map((job) => (
                  <VideoCard key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TutorialModal({ onClose }: { onClose: () => void }) {
  // Fermer sur Échap + verrouiller le scroll de la page tant que le modal est ouvert.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(17,17,17,0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 760,
          background: COLORS.bgCard,
          borderRadius: RADIUS.xl,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "18px 22px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.brandTintSoft,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              background: COLORS.brandTint,
              color: COLORS.brand,
            }}
          >
            <GraduationCap size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.ink0, letterSpacing: "-0.01em" }}>
              How to finish your video
            </div>
            <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 2, lineHeight: 1.45 }}>
              Three stages: generate the avatar video here, build the slides with Claude, then assemble
              everything in CapCut.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: "white",
              color: COLORS.ink2,
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          <TutorialStep index={1} icon={<FileText size={15} />} title="Transcript & avatar video — here, in Video Studio">
            <ol style={tutOl}>
              <li>
                In <b>1. Brief</b>, pick a client (or leave on <b>Auto</b>) and write the prompt: who it&apos;s for,
                the goal, the one key message, the tone and the call to action.
              </li>
              <li>
                Click <b>Propose transcript</b>, then review and edit the text the avatar will read. Spell tricky
                words phonetically so they sound right (e.g. <b>Coachello → kotchélo</b>).
              </li>
              <li>
                Set the <b>speech speed</b> (the banner recommends 1.0x for French, 0.85x for English) and check the
                estimated duration.
              </li>
              <li>
                Click <b>Generate video</b>. It renders in ~1-3 min and appears in the <b>Library</b> on the right.
              </li>
              <li>
                <b>Download</b> the avatar video (.mp4). You&apos;ll drop it into CapCut at step 3.
              </li>
            </ol>
          </TutorialStep>

          <TutorialStep index={2} icon={<LayoutTemplate size={15} />} title="Slides with Claude, then Google Slides">
            <ol style={tutOl}>
              <li>
                Open Claude, paste your final transcript and ask for the slides — e.g.{" "}
                <i>&quot;here&apos;s the transcript, make the slides for this video&quot;</i>. This triggers the{" "}
                <b>video-slides</b> skill.
              </li>
              <li>
                Claude gives you three things:
                <ul style={tutUl}>
                  <li>a <b>PPTX</b> in the Coachello design (editable);</li>
                  <li>a <b>PNG of every slide</b> at 1920×1080 (ready for editing);</li>
                  <li>
                    an <b>editing plan</b>: a table of timestamps + cue words telling you, beat by beat,{" "}
                    <b>where to cut</b> and which slide to show.
                  </li>
                </ul>
              </li>
              <li>
                Each slide keeps the <b>top-right corner empty</b> on purpose — that&apos;s where the avatar will sit.
              </li>
              <li>
                <i>(Optional)</i> Import the PPTX into <b>Google Slides</b> to tweak wording or branding. Then
                re-export each slide as PNG: <b>File → Download → PNG image</b>, one slide at a time. Keep the PNGs —
                those go into CapCut, not the PPTX.
              </li>
              <li>
                Keep the <b>editing plan</b> open beside you — it&apos;s your cut sheet for step 3.
              </li>
            </ol>
          </TutorialStep>

          <TutorialStep index={3} icon={<Scissors size={15} />} title="Assemble in CapCut">
            <ol style={tutOl}>
              <li>
                New <b>1920×1080</b> project. Import the <b>avatar .mp4</b> and <b>all the slide PNGs</b> (
                <ImageDown size={12} style={{ display: "inline", verticalAlign: "-1px", margin: "0 1px" }} /> import as
                PNG, not the PPTX).
              </li>
              <li>
                Put the <b>avatar on the top track</b>, the <b>slide PNGs on the track below</b>.
              </li>
              <li>
                Follow the editing plan&apos;s <b>cue words</b> (more reliable than the timestamps — the real pace
                varies). At each cue, put the playhead on the word, <b>Split</b> the avatar clip, and switch layout:
                <ul style={tutUl}>
                  <li>
                    <b>Intro & final CTA → avatar full-screen.</b> Hide the slide and scale the avatar to fill the
                    frame.
                  </li>
                  <li>
                    <b>Content beats → slide full-screen + avatar small, top-right.</b> Show the slide PNG underneath;
                    select the avatar clip and, in <b>Player → Scale</b>, set it to <b>~25%</b> width, then drag it into
                    the <b>top-right corner</b> (the empty zone the slides left for it).
                  </li>
                </ul>
              </li>
              <li>
                Trim each slide PNG so it stays on screen for the whole beat (<b>≥ 5 s</b> to stay readable), aligned
                to the avatar cuts.
              </li>
              <li>
                End on the <b>end-card</b> slide for ~3 s, then <b>Export</b> in 1080p.
              </li>
            </ol>

            <LayoutDiagram />
          </TutorialStep>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              color: COLORS.ink2,
              background: COLORS.bgSoft,
              border: `1px solid ${COLORS.line}`,
              borderRadius: RADIUS.md,
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          >
            <Info size={14} style={{ flexShrink: 0, marginTop: 1, color: COLORS.brand }} />
            <span>
              The <b>cue words</b> in Claude&apos;s editing plan are your source of truth for where to cut — line them
              up with the avatar&apos;s voice, not the clock.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "14px 22px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
          }}
        >
          <button type="button" onClick={onClose} style={{ ...primaryBtn(false), padding: "8px 18px" }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function TutorialStep({
  index,
  icon,
  title,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <span
          style={{
            width: 28,
            height: 28,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            color: "#fff",
            background: COLORS.brand,
            borderRadius: 999,
          }}
        >
          {index}
        </span>
        <span style={{ flex: 1, width: 2, background: COLORS.line, marginTop: 4, borderRadius: 999 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
          <span style={{ color: COLORS.brand, display: "inline-flex" }}>{icon}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{title}</span>
        </div>
        <div style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.55 }}>{children}</div>
      </div>
    </div>
  );
}

// Mini-schéma 16:9 des deux dispositions du montage : avatar plein écran vs
// slide plein écran avec avatar incrusté en haut à droite.
function LayoutDiagram() {
  const frame: React.CSSProperties = {
    position: "relative",
    flex: 1,
    aspectRatio: "16 / 9",
    borderRadius: 8,
    border: `1px solid ${COLORS.lineStrong}`,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...frame, background: COLORS.brandTint, color: COLORS.brand }}>Avatar</div>
          <div style={{ fontSize: 11, color: COLORS.ink3, textAlign: "center", marginTop: 5 }}>
            Intro & CTA — avatar full-screen
          </div>
        </div>
        <ArrowRight size={16} style={{ color: COLORS.ink4, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ ...frame, background: COLORS.bgSoft, color: COLORS.ink3 }}>
            Slide
            <div
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                width: "26%",
                aspectRatio: "16 / 9",
                borderRadius: 4,
                background: COLORS.brandTint,
                color: COLORS.brand,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                fontWeight: 700,
                border: `1px solid ${COLORS.brand}`,
              }}
            >
              Avatar
            </div>
          </div>
          <div style={{ fontSize: 11, color: COLORS.ink3, textAlign: "center", marginTop: 5 }}>
            Content — slide + avatar top-right
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTitle({ index, label }: { index: number; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.brand,
          background: COLORS.brandTint,
          borderRadius: 999,
        }}
      >
        {index}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{label}</span>
    </div>
  );
}

function VideoCard({ job }: { job: VideoJob }) {
  const date = job.created_at ? new Date(job.created_at).toLocaleString() : "";
  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOWS.card,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusBadge status={job.status} />
        {job.client_name && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: COLORS.ink2 }}>
            <Building2 size={11} />
            {job.client_name}
          </span>
        )}
        <span style={{ fontSize: 11, color: COLORS.ink3 }}>{date}</span>
        {job.status === "completed" && job.video_url && (
          <a
            href={job.video_url}
            download
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: COLORS.brand, textDecoration: "none" }}
          >
            <Download size={12} />
            Download
          </a>
        )}
      </div>
      {job.prompt && <div style={{ fontSize: 12, color: COLORS.ink2, lineHeight: 1.45 }}>{job.prompt}</div>}
      {job.status === "processing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink3 }}>
            <Loader2 size={12} className="animate-spin" />
            Rendering (usually 1-3 min)…
          </div>
          <div style={{ height: 4, borderRadius: 999, background: COLORS.bgSoft, overflow: "hidden" }}>
            <div className="vs-indeterminate" style={{ height: "100%", width: "40%", borderRadius: 999, background: COLORS.brand }} />
          </div>
        </div>
      )}
      {job.status === "failed" && <div style={{ fontSize: 12, color: COLORS.err }}>{job.error ?? "Generation failed"}</div>}
      {job.status === "completed" && job.video_url && (
        <video controls src={job.video_url} style={{ width: "100%", borderRadius: RADIUS.md, background: "#000" }} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: VideoJob["status"] }) {
  const map = {
    processing: { label: "Processing", color: COLORS.ink2 },
    completed: { label: "Ready", color: COLORS.brand },
    failed: { label: "Failed", color: COLORS.err },
  } as const;
  const s = map[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: s.color, background: COLORS.bgSoft, padding: "2px 8px", borderRadius: 999 }}>
      {s.label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>{label}</label>
      {children}
    </div>
  );
}

const tutOl: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const tutUl: React.CSSProperties = {
  margin: "5px 0 0",
  paddingLeft: 16,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  color: COLORS.ink2,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${COLORS.line}`,
  background: "white",
  color: COLORS.ink0,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: "white",
    color: COLORS.ink2,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: disabled ? COLORS.bgSoft : COLORS.brand,
    color: disabled ? COLORS.ink3 : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
