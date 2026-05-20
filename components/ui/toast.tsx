"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "info" | "success" | "error";

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (typeof window !== "undefined") {
      console.warn("useToast called outside ToastProvider, falling back to console");
    }
    return { toast: (msg) => console.log("[toast]", msg) };
  }
  return ctx;
}

const TYPE_STYLES: Record<ToastType, { border: string; bg: string; icon: typeof Info }> = {
  info: { border: "#6d28d9", bg: "#f5f3ff", icon: Info },
  success: { border: "#059669", bg: "#ecfdf5", icon: CheckCircle2 },
  error: { border: "#dc2626", bg: "#fef2f2", icon: AlertTriangle },
};

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    (message, type = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev, { id, type, message }]);
      const t = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, t);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed z-[2000] flex flex-col gap-2"
        style={{ top: 16, right: 16, maxWidth: "min(420px, calc(100vw - 32px))" }}
        aria-live="polite"
        aria-atomic="true"
      >
        {items.map((item) => {
          const style = TYPE_STYLES[item.type];
          const Icon = style.icon;
          return (
            <div
              key={item.id}
              role={item.type === "error" ? "alert" : "status"}
              className="flex items-start gap-2 rounded-lg shadow-md text-sm"
              style={{
                background: style.bg,
                border: `1px solid ${style.border}`,
                borderLeftWidth: 4,
                padding: "10px 12px",
                color: "#111",
              }}
            >
              <Icon size={16} style={{ color: style.border, flexShrink: 0, marginTop: 2 }} />
              <div className="flex-1 whitespace-pre-line">{item.message}</div>
              <button
                onClick={() => dismiss(item.id)}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Fermer la notification"
                style={{ marginTop: 1 }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
