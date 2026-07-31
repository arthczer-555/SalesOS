"use client";

import { useRef, useState } from "react";
import {
  EMPTY_SIGNATURE,
  normalizeSignature,
  renderSignatureHtml,
  type EmailSignature,
} from "@/lib/email/signature";

// Redimensionne l'image côté client (max 480px) pour garder une data URL légère.
async function fileToResizedDataUrl(file: File, maxDim = 480): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(outType, 0.85);
}

export function SignatureEditor({
  initialValue,
  initialName,
}: {
  initialValue: EmailSignature | null;
  initialName: string;
}) {
  const [open, setOpen] = useState(false);
  const [sig, setSig] = useState<EmailSignature>(
    initialValue
      ? normalizeSignature(initialValue)
      : { ...EMPTY_SIGNATURE, enabled: true, fullName: initialName },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof EmailSignature>(key: K, value: EmailSignature[K]) =>
    setSig((p) => ({ ...p, [key]: value }));

  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImgError("Choose an image file.");
    if (file.size > 8 * 1024 * 1024) return setImgError("Image too large (max 8 MB).");
    setImgError(null);
    try {
      set("image", await fileToResizedDataUrl(file));
    } catch {
      setImgError("Could not read this image.");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/user/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_signature: sig }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const previewHtml = renderSignatureHtml(sig);

  return (
    <div className="rounded-xl border" style={{ borderColor: "#eeeeee", background: "#fff" }}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: "#111" }}>Email signature</p>
            {sig.enabled ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#dcfce7", color: "#166534" }}>
                On
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#475569" }}>
                Off
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "#888" }}>
            Your personal signature, added to emails sent from the Prospecting page.
          </p>
        </div>
        <svg
          className="shrink-0 ml-4 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", color: "#aaa" }}
          width="16" height="16" viewBox="0 0 16 16" fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t" style={{ borderColor: "#f5f5f5" }}>
          {/* Enabled toggle */}
          <label className="flex items-center gap-2 pt-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sig.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              className="accent-[#f01563]"
            />
            <span className="text-xs" style={{ color: "#555" }}>Add my signature to my prospecting emails</span>
          </label>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name">
              <TextInput value={sig.fullName} onChange={(v) => set("fullName", v)} />
            </Field>
            <Field label="Title">
              <TextInput value={sig.title} onChange={(v) => set("title", v)} />
            </Field>
            <Field label="Booking link">
              <TextInput value={sig.bookingUrl} onChange={(v) => set("bookingUrl", v)} />
            </Field>
            <Field label="Booking link text">
              <TextInput value={sig.bookingLabel} onChange={(v) => set("bookingLabel", v)} />
            </Field>
            <Field label="Languages">
              <TextInput value={sig.languages} onChange={(v) => set("languages", v)} />
            </Field>
            <Field label="Phone">
              <TextInput value={sig.phone} onChange={(v) => set("phone", v)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sig.showLogo}
              onChange={(e) => set("showLogo", e.target.checked)}
              className="accent-[#f01563]"
            />
            <span className="text-xs" style={{ color: "#555" }}>Show the COACHELLO wordmark</span>
          </label>

          {/* Photo (optional) */}
          <div>
            <p className="text-[11px] font-medium mb-1.5" style={{ color: "#888" }}>Photo (optional)</p>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />
            {sig.image ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sig.image} alt="" style={{ maxWidth: 80, maxHeight: 80, borderRadius: 8, border: "1px solid #eee" }} />
                <div className="flex flex-col gap-2">
                  {/* Position */}
                  <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "#e5e5e5", width: "fit-content" }}>
                    {(["above", "below"] as const).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => set("imagePosition", pos)}
                        className="text-[11px] px-2.5 py-1 transition-colors"
                        style={{
                          background: sig.imagePosition === pos ? "#f01563" : "#fff",
                          color: sig.imagePosition === pos ? "#fff" : "#888",
                        }}
                      >
                        {pos === "above" ? "Above text" : "Below text"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => imageInputRef.current?.click()} className="text-[11px]" style={{ color: "#2563eb" }}>
                      Replace
                    </button>
                    <button onClick={() => set("image", "")} className="text-[11px]" style={{ color: "#aaa" }}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: "#e5e5e5", color: "#555" }}
              >
                Upload an image
              </button>
            )}
            {imgError && <p className="text-[11px] mt-1.5" style={{ color: "#f01563" }}>{imgError}</p>}
            <p className="text-[10px] mt-1.5" style={{ color: "#bbb" }}>
              Embedded in the email so it always displays (no &quot;show images&quot; needed).
            </p>
          </div>

          {/* Live preview */}
          <div>
            <p className="text-[11px] font-medium mb-1.5" style={{ color: "#888" }}>Preview</p>
            <div className="rounded-lg border p-4" style={{ borderColor: "#eee", background: "#fafafa", minHeight: 60 }}>
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <p className="text-xs" style={{ color: "#bbb" }}>Fill in the fields to see the preview.</p>
              )}
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="text-xs px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: saved ? "#dcfce7" : "#f01563", color: saved ? "#166534" : "#fff" }}
          >
            {saving ? "Saving..." : saved ? "Saved!" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium block mb-1" style={{ color: "#888" }}>{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-xs px-3 py-2 border rounded-lg outline-none"
      style={{ borderColor: "#e5e5e5", color: "#111" }}
    />
  );
}
