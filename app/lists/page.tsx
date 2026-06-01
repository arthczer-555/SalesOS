import { redirect } from "next/navigation";

// La gestion des listes vit désormais dans un onglet de la Watch List.
export default function ListsRedirect() {
  redirect("/watchlist?tab=lists");
}
