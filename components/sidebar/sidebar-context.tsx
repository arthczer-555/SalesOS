"use client";

import * as React from "react";

type SetCollapsed = (value: boolean, opts?: { user?: boolean }) => void;

type Ctx = {
  collapsed: boolean;
  setCollapsed: SetCollapsed;
  toggle: () => void;
};

const SidebarCtx = React.createContext<Ctx | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // La sidebar est ouverte par défaut sur toutes les pages, à chaque chargement.
  // L'utilisateur peut la replier via le toggle, ce choix vaut pour la navigation
  // en cours et n'est pas persisté.
  const [collapsed, setCollapsedRaw] = React.useState<boolean>(false);

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

/**
 * Replie la sidebar tant que la page est montée (pages larges comme le board
 * /deals) et remet l'état d'avant en la quittant. Le toggle reste utilisable.
 */
export function useAutoCollapseSidebar() {
  const { collapsed, setCollapsed } = useSidebar();
  const initial = React.useRef(collapsed);
  React.useEffect(() => {
    const previous = initial.current;
    setCollapsed(true);
    return () => setCollapsed(previous);
  }, [setCollapsed]);
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
