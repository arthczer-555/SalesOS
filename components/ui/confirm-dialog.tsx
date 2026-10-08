"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./modal";
import { Button } from "./button";
import { COLORS } from "@/lib/design/tokens";

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

// Remplace window.confirm : `const { confirm, dialog } = useConfirm()` puis
// `if (await confirm({...}))` et rendre `{dialog}` dans le composant.
export function useConfirm() {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve });
      }),
    [],
  );

  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  const dialog = state ? (
    <Modal
      open
      onClose={() => close(false)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {state.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant={state.danger ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 12 }}>
        {state.danger ? (
          <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: "grid", placeItems: "center", background: COLORS.errBg, color: COLORS.err }}>
            <AlertTriangle size={16} />
          </div>
        ) : null}
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>{state.title}</div>
          {state.description ? <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 4, lineHeight: 1.5 }}>{state.description}</div> : null}
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, dialog };
}
