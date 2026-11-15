import { PageBody } from "@/components/app/PageBody";
import { AllConversations } from "@/components/conversations/AllConversations";
import { initialConversations } from "@/lib/first-screen-server";

// Toutes les conversations : celles du chat d'entreprise et de chaque Expert, en une liste, lue avec la page.
export default async function Page() {
  return (
    <PageBody>
      <AllConversations initial={await initialConversations()} />
    </PageBody>
  );
}
