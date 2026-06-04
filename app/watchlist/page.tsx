import { redirect } from "next/navigation";

// La Watch List vit désormais dans le hub /watchlist/companies (onglets Board +
// Liste). On redirige l'ancienne URL pour ne rien casser.
export default function WatchListIndex() {
  redirect("/watchlist/companies");
}
