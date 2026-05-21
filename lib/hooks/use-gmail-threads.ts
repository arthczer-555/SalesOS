import useSWR from "swr";

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

interface GmailSearchResponse {
  messages: GmailMessage[];
  error?: string;
}

export function useGmailThreads(email: string | null) {
  const key = email ? `/api/gmail/search?q=${encodeURIComponent(email)}&maxResults=10` : null;
  const { data, isLoading } = useSWR<GmailSearchResponse>(key, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return {
    messages: data?.messages ?? [],
    isLoading,
    error: data?.error ?? null,
  };
}
