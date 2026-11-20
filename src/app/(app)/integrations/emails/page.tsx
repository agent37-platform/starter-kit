import { PageBody } from "@/components/app/PageBody";
import { MailRightsView } from "@/components/integrations/MailRightsView";

// Intégrations · E-mails : pour chaque expert, s'il peut écrire, à la demande de qui, et à qui.
// Les réglages sont lus et posés au back-office, qui les applique à chaque envoi.
export default function Page() {
  return (
    <PageBody>
      <MailRightsView />
    </PageBody>
  );
}
