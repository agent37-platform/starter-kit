import { requireBackofficeToken } from "@/lib/auth";

// The parts of a large document are kept by the back office (docs/plans/envois-en-morceaux.md): these routes only
// relay, with the member's own session (or the phone's token). Without a back office that signs in, a document over
// 4 MB cannot be sent, as before.
export const uploadToken = (): Promise<string> => requireBackofficeToken("Ce fichier dépasse 4 Mo, la taille maximale d’un envoi.");
