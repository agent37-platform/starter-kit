"use client";

import { DeliverableWatcher } from "@/components/activity/DeliverableWatcher";
import { InstanceEventStream } from "@/components/activity/InstanceEventStream";
import { syncPrefs } from "@/lib/prefs-sync";
import { SearchDialog } from "@/components/conversations/SearchDialog";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { CompanyColors } from "@/components/app/CompanyColors";
import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ActivityProvider } from "@/components/activity/ActivityProvider";
import { Sidebar } from "@/components/app/Sidebar";
import { NavProgress } from "@/components/app/NavProgress";
import { ReadAhead } from "@/components/app/ReadAhead";
import { AnalyticsReadAhead } from "@/components/settings/analytics/AnalyticsReadAhead";
import { TopBar } from "@/components/app/TopBar";
import { DeployStatusProvider, UpdateStrip } from "@/components/app/DeployStatus";
import { NightStrip } from "@/components/app/NightReview";
import { ComputerProvider } from "@/components/experts/ComputerProvider";
import { ExpertsProvider } from "@/components/experts/ExpertsProvider";
import type { InitialExperts } from "@/components/experts/useExperts";
import { CallProvider, CallStrip } from "@/components/voice/CallProvider";
import { YeleBubble } from "@/components/yele/YeleBubble";
import { cn } from "@/lib/utils";
import { remember } from "@/lib/client-cache";
import type { CatalogueResponse, MergedAgent } from "@/lib/types";
import { AgentsProvider } from "@/components/useMyAgents";
import { catalogueKey } from "@/components/experts/useCatalogue";

const COLLAPSE_KEY = "sbmini";

/**
 * Le cadre unique de l'application : menu à gauche, barre en haut, contenu à droite.
 *
 * Il n'y a qu'une coquille, pour tout : l'espace d'un expert s'ouvre dedans, et c'est
 * ce qui supprime l'écran de choix d'instance du kit — la liste des experts est en
 * permanence dans le menu.
 *
 * Sur téléphone le menu devient un tiroir : fermé par défaut, ouvert par le bouton de la
 * barre du haut, refermé à chaque navigation.
 *
 * Le <main> ne pose aucune marge : chaque page choisit son mode en enveloppant ou non
 * son contenu dans <Page>.
 */
export function AppShell({
  children,
  initialExperts,
  initialAgents = null,
  initialCatalogue = null,
}: {
  children: React.ReactNode;
  initialExperts: InitialExperts | null;
  initialAgents?: MergedAgent[] | null;
  initialCatalogue?: CatalogueResponse | null;
}) {
  // The member's notification and conversation choices, from the back office, before the first notice.
  useEffect(() => void syncPrefs(), []);
  const { current, userEmail } = useWorkspace();
  const chatOnly = current?.access === "entreprise";
  // The catalogue the server read with the page: every screen that lists it starts from it.
  useState(() => current && initialCatalogue && remember(catalogueKey(userEmail, current.id), initialCatalogue));
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // "Son ordinateur" keeps ONE live connection, to the instance last opened, so moving between its
  // experts (or to another page and back) does not reconnect. Another instance starts afresh.
  const routeAgentId = pathname.startsWith("/experts/") ? (pathname.split("/")[2] ?? null) : null;
  const [computerAgentId, setComputerAgentId] = useState<string | null>(routeAgentId);
  if (routeAgentId && routeAgentId !== computerAgentId) setComputerAgentId(routeAgentId);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Stockage indisponible : le menu s'ouvre déplié, ce qui est le bon défaut.
    }
  }, []);

  // Une navigation depuis le tiroir le referme.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Échap referme le tiroir, comme toute fenêtre posée par-dessus la page.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function toggle() {
    // Dans le tiroir, le bouton du menu le referme au lieu de le replier.
    if (drawerOpen) {
      setDrawerOpen(false);
      return;
    }
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Le choix ne survivra pas au rechargement.
      }
      return next;
    });
  }

  return (
    <AgentsProvider workspaceId={current?.id ?? null} initial={initialAgents}>
    <ExpertsProvider initial={initialExperts}>
      <DeployStatusProvider>
      <ActivityProvider>
        {/* The call lives above the pages: it goes on, folded or not, while the member navigates. */}
        <CallProvider>
        <CompanyColors />
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <ReadAhead />
        <AnalyticsReadAhead />
        <DeliverableWatcher />
        <InstanceEventStream />
        <SearchDialog />
        <div
          className="min-h-screen md:grid"
          // --shell-nav: where the working area starts, for what covers it (an enlarged dashboard).
          style={{ gridTemplateColumns: `${collapsed ? 72 : 272}px minmax(0,1fr)`, ["--shell-nav" as string]: `${collapsed ? 72 : 272}px` }}
        >
          {drawerOpen && (
            <button
              type="button"
              aria-label="Fermer le menu"
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-30 bg-ink/40 md:hidden"
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-[284px] shadow-xl transition-transform md:shadow-none md:static md:z-auto md:w-auto md:translate-x-0",
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <Sidebar collapsed={collapsed && !drawerOpen} onToggle={toggle} onNavigate={() => setDrawerOpen(false)} />
          </div>
          {/* Le <main> est la zone qui défile : la hauteur est bornée à l'écran pour que le chat et les
              fichiers gardent leur barre de saisie en bas, les pages longues défilant à l'intérieur. */}
          <main className="flex h-screen min-w-0 flex-col overflow-y-auto">
            <TopBar onMenu={() => setDrawerOpen(true)} />
            <UpdateStrip />
            {!chatOnly && <NightStrip />}
            <CallStrip />
            <ComputerProvider key={computerAgentId ?? "none"} agentId={computerAgentId}>
              {children}
            </ComputerProvider>
            <YeleBubble />
          </main>
        </div>
        </CallProvider>
      </ActivityProvider>
      </DeployStatusProvider>
    </ExpertsProvider>
    </AgentsProvider>
  );
}
