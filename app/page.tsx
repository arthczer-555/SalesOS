import { redirect } from "next/navigation";

// `/` est la porte d'entrée de SalesOS : on y arrive après connexion, depuis un
// signet, ou par les `redirect("/")` des pages admin refusées à un non-admin.
// Elle ne rend rien et envoie vers la page d'accueil du moment, aujourd'hui le
// dashboard personnel. Garder cette indirection évite de retoucher tous les
// appelants le jour où l'accueil change.
//
// Le chat, qui vivait ici, est passé sur /chat. Les anciens liens (dont
// `/?q=<question>`) atterrissent donc sur le dashboard : on préserve la
// question en la repassant à /chat plutôt que de la perdre en route.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const question = q?.trim();
  redirect(question ? `/chat?q=${encodeURIComponent(question)}` : "/dashboard");
}
