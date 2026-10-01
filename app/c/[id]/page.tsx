import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ChatWorkspace } from "@/app/_components/chat-workspace";
import { SharedConversationView } from "./shared-view";
import type { Message } from "@/app/_components/chat-message";

export const dynamic = "force-dynamic";

// URL d'une conversation CoachelloAI. Partager = envoyer ce lien, il n'y a
// rien à activer.
// - L'auteur retombe sur le chat complet, conversation chargée, et continue à écrire.
// - Un autre membre l'ouvre en lecture seule.
// L'auth Clerk est exigée en amont par le middleware : le lien ne sort jamais
// de l'équipe.
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) notFound();

  const { data: conv } = await db
    .from("conversations")
    .select("id, title, user_id")
    .eq("id", id)
    .single();

  if (!conv) notFound();

  if (conv.user_id === user.id) return <ChatWorkspace initialConversationId={id} />;

  const [{ data: owner }, { data: rows }] = await Promise.all([
    db.from("users").select("name, email").eq("id", conv.user_id).single(),
    db
      .from("conversation_messages")
      .select("role, content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  return (
    <SharedConversationView
      title={conv.title}
      ownerName={owner?.name ?? owner?.email ?? null}
      messages={(rows ?? []) as Message[]}
    />
  );
}
