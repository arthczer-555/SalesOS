import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pokedex",
  description: "Coachello internal tools directory",
};

export default function PokedexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
