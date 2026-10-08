import { redirect } from "next/navigation";

// L'ancienne page "single" est remplacée par l'app Prospecting (campagnes,
// séquences, inbox) : /prospecting ouvre directement les campagnes.
export default function ProspectingIndex() {
  redirect("/prospecting/campaigns");
}
