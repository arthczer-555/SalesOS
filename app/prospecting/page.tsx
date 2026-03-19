"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { Paperclip, Send, Save, X } from "lucide-react";
import Link from "next/link";

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

export default function ProspectingPage() {
  const { user } = useUser();
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
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
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then(({ connected }) => setGmailConnected(connected))
      .catch(() => setGmailConnected(false));
  }, []);

  const fromEmail = user?.emailAddresses[0]?.emailAddress ?? "";

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
    setStatus(null);
    try {
      const r = await fetch("/api/gmail/send", { method: "POST", body: buildFormData() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setStatus({ type: "success", msg: "Email envoyé !" });
      setTo([]); setCc([]); setBcc([]); setSubject(""); setBody(""); setAttachments([]);
    } catch (e) {
      setStatus({ type: "error", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async () => {
    if (!subject && !body) return;
    setDrafting(true);
    setStatus(null);
    try {
      const r = await fetch("/api/gmail/draft", { method: "POST", body: buildFormData() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setStatus({ type: "success", msg: "Brouillon sauvegardé dans Gmail !" });
    } catch (e) {
      setStatus({ type: "error", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setDrafting(false);
    }
  };

  const canSend = to.length > 0 && !!subject && !!body && !!gmailConnected && !sending;
  const canDraft = (!!subject || !!body) && !!gmailConnected && !drafting;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#f0f0f0" }}>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: "#111" }}>Prospection</h1>
          <p className="text-xs" style={{ color: "#aaa" }}>Compose et envoie tes emails depuis Gmail</p>
        </div>
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

      {/* Composer */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: "#e5e5e5" }}>

          {/* Not connected banner */}
          {gmailConnected === false && (
            <div className="px-4 py-2.5 text-xs text-center" style={{ background: "#fff8f0", color: "#c2410c", borderBottom: "1px solid #ffe4c4" }}>
              Gmail non connecté —{" "}
              <Link href="/settings" className="underline font-medium">connecte-le dans Settings</Link>
              {" "}pour envoyer des emails.
            </div>
          )}

          {/* From */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
            <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>De</span>
            <span className="text-sm" style={{ color: "#888" }}>{fromEmail || "…"}</span>
          </div>

          {/* To */}
          <TagInput
            label="À"
            tags={to}
            onAdd={addTo}
            onRemove={(t) => setTo((p) => p.filter((x) => x !== t))}
            placeholder="destinataire@email.com — Entrée pour ajouter"
          />

          {/* CC */}
          {showCc && (
            <TagInput
              label="Cc"
              tags={cc}
              onAdd={addCc}
              onRemove={(t) => setCc((p) => p.filter((x) => x !== t))}
              placeholder="cc@email.com"
            />
          )}

          {/* BCC */}
          {showBcc && (
            <TagInput
              label="Bcc"
              tags={bcc}
              onAdd={addBcc}
              onRemove={(t) => setBcc((p) => p.filter((x) => x !== t))}
              placeholder="bcc@email.com"
            />
          )}

          {/* CC / BCC toggles */}
          {(!showCc || !showBcc) && (
            <div className="flex gap-3 px-4 py-1.5 border-b" style={{ borderColor: "#f0f0f0" }}>
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-xs transition-colors"
                  style={{ color: "#ccc" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f01563")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
                >
                  + Cc
                </button>
              )}
              {!showBcc && (
                <button
                  onClick={() => setShowBcc(true)}
                  className="text-xs transition-colors"
                  style={{ color: "#ccc" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f01563")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
                >
                  + Bcc
                </button>
              )}
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "#f0f0f0" }}>
            <span className="text-xs font-medium w-10 shrink-0" style={{ color: "#aaa" }}>Objet</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet de l'email"
              className="flex-1 text-sm outline-none bg-transparent font-medium"
              style={{ color: "#111" }}
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Écris ton email ici…"
            className="w-full resize-none outline-none text-sm leading-relaxed p-4"
            style={{ color: "#111", minHeight: "340px" }}
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="px-4 py-2.5 border-t flex flex-wrap gap-2" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
              {attachments.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: "#f0f0f0", color: "#555" }}
                >
                  <Paperclip size={10} />
                  {f.name}
                  <span className="text-[10px]" style={{ color: "#aaa" }}>
                    ({(f.size / 1024).toFixed(0)} Ko)
                  </span>
                  <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="hover:opacity-70 flex items-center ml-0.5">
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
            <div>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: "#bbb" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#555")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#bbb")}
              >
                <Paperclip size={14} />
                Joindre un fichier
              </button>
            </div>

            <div className="flex items-center gap-2">
              {status && (
                <span className="text-xs" style={{ color: status.type === "success" ? "#16a34a" : "#f01563" }}>
                  {status.msg}
                </span>
              )}
              <button
                onClick={saveDraft}
                disabled={!canDraft}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{
                  borderColor: canDraft ? "#d4d4d4" : "#eee",
                  color: canDraft ? "#555" : "#ccc",
                  cursor: canDraft ? "pointer" : "not-allowed",
                }}
              >
                <Save size={12} />
                {drafting ? "…" : "Brouillon Gmail"}
              </button>
              <button
                onClick={send}
                disabled={!canSend}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-opacity"
                style={{
                  background: "#f01563",
                  color: "#fff",
                  opacity: canSend ? 1 : 0.4,
                  cursor: canSend ? "pointer" : "not-allowed",
                }}
              >
                <Send size={12} />
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
