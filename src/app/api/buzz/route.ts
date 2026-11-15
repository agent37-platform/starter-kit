import { backoffice } from "@/lib/backoffice";
import { withPhotos } from "@/lib/buzz";
import { loadCatalogue, matchCatalogue } from "@/lib/catalogue";
import { handleError, json } from "@/lib/http";
import { mailToken as sessionToken, noStore } from "../mail/_session";

// `GET /api/buzz` — the members' messaging: relay address, the member's devices, directory, salons.
// Relayed with the member's own session; the back office decides who is listed. Experts get their
// catalogue portrait here (the catalogue never fails: without it, initials).
export async function GET() {
  try {
    const [overview, catalogue] = await Promise.all([backoffice.buzz(await sessionToken()), loadCatalogue()]);
    const annuaire = withPhotos(overview.annuaire, (profil) => matchCatalogue(catalogue.experts, profil)?.avatarUrl ?? null);
    return noStore(json({ ...overview, annuaire }));
  } catch (e) {
    return handleError(e);
  }
}
