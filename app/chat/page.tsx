import { ChatWorkspace } from "@/app/_components/chat-workspace";

// Nouveau chat. Dès le premier message, l'URL devient /c/<id> (voir
// ChatWorkspace) pour que la conversation soit adressable et partageable.
//
// Le chat vivait sur `/` avant que le dashboard ne devienne la page d'accueil.
// `/` redirige désormais ici pour les anciens liens.
//
// `?q=` permet d'arriver ici avec une question déjà posée : c'est ce que fait
// la pastille « Any question ? » présente sur le reste de l'app.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <ChatWorkspace initialPrompt={q?.trim() || undefined} />;
}
