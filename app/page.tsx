import { ChatWorkspace } from "./_components/chat-workspace";

// Nouveau chat. Dès le premier message, l'URL devient /c/<id> (voir
// ChatWorkspace) pour que la conversation soit adressable et partageable.
//
// `?q=` permet d'arriver ici avec une question déjà posée : c'est ce que fait
// la pastille « Any question ? » présente sur le reste de l'app.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <ChatWorkspace initialPrompt={q?.trim() || undefined} />;
}
