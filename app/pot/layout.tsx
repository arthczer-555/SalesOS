import type { Metadata } from "next";
import { DM_Sans, Inter } from "next/font/google";

// Polices de la maquette "The Coachello Pot", limitées à cette page.
const display = DM_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--pot-display" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--pot-body" });

export const metadata: Metadata = {
  title: "The Coachello Pot",
  description: "Team pot: every €50k of 2026 revenue puts money in the pot",
};

export default function PotLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${body.variable}`}>{children}</div>;
}
