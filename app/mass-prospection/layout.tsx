import type { Metadata } from "next";

// Titre de l'onglet. La page est "use client" et ne peut pas exporter de metadata.
export const metadata: Metadata = { title: "Mass Prospection" };

export default function MassProspectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
