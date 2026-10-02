import type { Metadata } from "next";

// Titre de l'onglet. La page est "use client" et ne peut pas exporter de metadata.
export const metadata: Metadata = { title: "Prospecting lists" };

export default function ProspectingListsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
