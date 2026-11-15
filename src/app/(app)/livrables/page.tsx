import { AllDeliverables } from "@/components/files/AllDeliverables";
import { initialDrives } from "@/lib/first-screen-server";

// Tous les livrables, ouverts par « Voir tous » sous les derniers livrables de l'accueil (pas au menu).
export default async function Page() {
  return <AllDeliverables initial={await initialDrives()} />;
}
