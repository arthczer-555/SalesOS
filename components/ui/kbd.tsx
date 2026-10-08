import * as React from "react";

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ds-kbd">{children}</kbd>;
}
