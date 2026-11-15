"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MembersView, type LoadedMembers } from "@/components/MembersView";
import { usePublicConfig } from "@/components/PublicConfigProvider";
import { PageBody } from "@/components/app/PageBody";
import { useWorkspace } from "@/components/WorkspaceProvider";

// Administration : pour un admin, la liste des membres de l'espace, en lecture (l'espace, ses
// membres et leurs instances se gèrent dans le back-office Yelema). Un membre n'a ici que
// l'onglet Entreprise, là où le back-office connecte ; sinon rien, et il est renvoyé aux intégrations.
export function MembersPage({ initial }: { initial: LoadedMembers | null }) {
  const router = useRouter();
  const { current } = useWorkspace();
  const { authVia } = usePublicConfig();
  const admin = current?.role === "admin";

  useEffect(() => {
    if (current && !admin) router.replace(authVia === "backoffice" ? "/parametres/entreprise" : "/integrations/connecteurs");
  }, [current, admin, authVia, router]);

  if (!admin) return null;
  return (
    <PageBody>
      <MembersView initial={initial} />
    </PageBody>
  );
}
