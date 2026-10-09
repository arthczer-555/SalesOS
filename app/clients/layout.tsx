import type { Metadata } from "next";

// Titre de l'onglet. La page est "use client" et ne peut pas exporter de metadata.
export const metadata: Metadata = { title: "Clients" };

// .ch-warm : palette chaude de la liste et des fiches (variables CSS, cf.
// globals.css et _components/theme.ts). display: contents, sans effet sur la
// mise en page.
export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return <div className="ch-warm">{children}</div>;
}
