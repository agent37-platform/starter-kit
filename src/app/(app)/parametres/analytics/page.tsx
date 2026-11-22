import { Suspense } from "react";
import { AnalyticsDashboard } from "@/components/settings/analytics/AnalyticsDashboard";
import { PageBody } from "@/components/app/PageBody";

// Paramètres · Personnel · Analytics : la consommation de l'instance du membre connecté, et d'elle seule,
// telle qu'elle l'a enregistrée.
export default function Page() {
  return (
    <PageBody>
      <Suspense>
        <AnalyticsDashboard />
      </Suspense>
    </PageBody>
  );
}
