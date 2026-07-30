"use client";

import * as React from "react";

type SetCollapsed = (value: boolean, opts?: { user?: boolean }) => void;

type Ctx = {
  collapsed: boolean;
  setCollapsed: SetCollapsed;
  toggle: () => void;
};

const SidebarCtx = React.createContext<Ctx | null>(null);

// Clés d'une ancienne logique (collapse auto + override par page). Nettoyées au
// montage pour ne pas laisser traîner de préférence qui refermait la sidebar.
const LEGACY_KEYS = ["salesos.sidebar.collapsed", "salesos.sidebar.userOverride"];

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // La sidebar est ouverte par défaut sur toutes les pages, à chaque chargement.
  // L'utilisateur peut la replier via le toggle, ce choix vaut pour la navigation
  // en cours et n'est pas persisté.
  const [collapsed, setCollapsedRaw] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    } catch {}
  }, []);

  const setCollapsed: SetCollapsed = React.useCallback((value) => {
    setCollapsedRaw(value);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsedRaw((prev) => !prev);
  }, []);

  const value = React.useMemo<Ctx>(
    () => ({ collapsed, setCollapsed, toggle }),
    [collapsed, setCollapsed, toggle]
  );

  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}

export function useSidebar(): Ctx {
  const ctx = React.useContext(SidebarCtx);
  if (!ctx) {
    // Safe fallback for components that render outside the provider (tests/storybook)
    return {
      collapsed: false,
      setCollapsed: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
