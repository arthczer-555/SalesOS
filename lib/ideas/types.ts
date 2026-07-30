// Types et bornes de la boîte à idées. Aucun import : ce module est importé par
// le composant client du dashboard, il ne doit pas entraîner `lib/db` (et la
// service role key) dans le bundle navigateur.

/** Bornage du texte : assez pour un paragraphe, pas pour coller un document. */
export const IDEA_MAX_LENGTH = 2000;

/** Au-delà, la table admin devient illisible et la lecture n'est plus le bon outil. */
export const IDEAS_LIMIT = 500;

export interface Idea {
  id: string;
  content: string;
  createdAt: string;
  authorName: string | null;
  authorEmail: string | null;
}
