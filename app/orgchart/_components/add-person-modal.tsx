"use client";

import { useState } from "react";
import { Modal, modalInput, PrimaryBtn, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import type { OrgPersonInput } from "@/lib/orgchart/types";

interface Props {
  onClose: () => void;
  onCreate: (fields: OrgPersonInput) => void;
  busy?: boolean;
}

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: COLORS.ink2, marginBottom: 3, display: "block" };

export function AddPersonModal({ onClose, onCreate, busy }: Props) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [entity, setEntity] = useState("");
  const [linkedin, setLinkedin] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      title: title.trim() || null,
      entity: entity.trim() || null,
      linkedin_url: linkedin.trim() || null,
      source: "manual",
    });
  };

  return (
    <Modal
      title="Add person"
      onClose={onClose}
      footer={
        <>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={submit} disabled={busy || !name.trim()}>
            Add
          </PrimaryBtn>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Name *</label>
        <input autoFocus style={modalInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Title</label>
        <input style={modalInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head of L&D" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Entity / Location</label>
        <input style={modalInput} value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="France - Allianz Trade" />
      </div>
      <div>
        <label style={label}>LinkedIn URL</label>
        <input style={modalInput} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
      </div>
    </Modal>
  );
}
