import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { GA4_METRICS, GA4_DIMENSIONS, GA4_PRESETS } from "@/lib/ga4-catalog";
import { Playground } from "./_components/playground";

export const dynamic = "force-dynamic";

export default async function Ga4DebugPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/");

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "#111" }}>GA4 Debug Playground</h1>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          Teste n&apos;importe quelle combinaison metrics × dimensions × période. Compare ce que GA4 renvoie avec ce que l&apos;overview affiche.
        </p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>
          Property GA4 : <code className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "#f5f5f5" }}>{process.env.GA4_PROPERTY_ID ?? "non configuré"}</code>
        </p>
      </div>

      <Playground
        metricsCatalog={GA4_METRICS}
        dimensionsCatalog={GA4_DIMENSIONS}
        presets={GA4_PRESETS}
      />
    </div>
  );
}
