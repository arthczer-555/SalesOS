"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

// Zone de dépôt de fichier (clic ou glisser-déposer).
export function FileDropzone({
  accept,
  onFile,
  title = "Drop a file here or click to browse",
  hint,
  disabled,
}: {
  accept?: string;
  onFile: (file: File) => void;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const [active, setActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ds-dropzone ds-focusable ${active ? "ds-dropzone-active" : ""}`.trim()}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
      style={{ padding: "34px 20px", textAlign: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          margin: "0 auto 10px",
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: "#fff",
          border: `1px solid ${COLORS.line}`,
          color: COLORS.brand,
        }}
      >
        <UploadCloud size={20} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{title}</div>
      {hint ? <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 4 }}>{hint}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
