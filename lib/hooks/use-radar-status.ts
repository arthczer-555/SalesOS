import useSWR from "swr";
import type { RadarProfile } from "@/lib/intel-types";

interface RadarResponse {
  profiles: RadarProfile[];
}

/**
 * Récupère la liste des profils LinkedIn actuellement au Radar et expose
 * un Set d'usernames pour des lookups O(1) côté UI (badge "Au Radar").
 *
 * Une seule requête partagée entre tous les composants grâce au cache SWR.
 */
export function useRadarStatus() {
  const { data, error, isLoading, mutate } = useSWR<RadarResponse>(
    "/api/intel/enrich/radar",
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const profiles = data?.profiles ?? [];
  const usernames = new Set(profiles.map((p) => p.username).filter(Boolean));

  return {
    profiles,
    usernames,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "") : "",
    reload: () => mutate(),
    has: (username: string | null | undefined) => (username ? usernames.has(username) : false),
  };
}
