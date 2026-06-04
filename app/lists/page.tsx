import { redirect } from "next/navigation";

// La gestion des listes vit désormais sur /watchlist/lists.
export default function ListsRedirect() {
  redirect("/watchlist/lists");
}
