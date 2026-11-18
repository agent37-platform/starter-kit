"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isDriveClutter } from "@/lib/drive-order";
import { ARCHIVE_FOLDER, isArchived } from "@/lib/drive-versions";
import { deliveryNotices, isMemberUpload, type DeliveryNotice } from "@/lib/drive-paths";
import { driveTree, onDriveChanged } from "@/lib/drive-store";
import { agentTabPath } from "@/lib/expert-tabs";
import { readNotifyPrefs, saveNotifyPrefs } from "@/lib/notify-prefs";
import { useOwnAgentId } from "@/components/conversations/useAllConversations";
import { usePoll } from "@/components/usePoll";
import { usePublicConfig } from "@/components/PublicConfigProvider";
import { askNotificationPermission, notificationSupport, systemNotify } from "./system-notify";

// A file of the drive (three levels deep) the page has not seen yet is a new deliverable, announced
// like a reply (toast, system notification when the tab is hidden) unless switched off in Paramètres.
// The drive is read when something may have written there (the stream's `files.changed`, settled by the
// drive store), the tab shown again, and every 10 minutes while visible and the stream is down. The
// first reading (usually the tab's bootstrap) is the baseline: nothing already there is announced.
const SAFETY_MS = 10 * 60_000;
// What one pop-up lists at most, however long the tab stays open.
const MAX_SHOWN = 20;
// Back on the tab after this long away: one look.
const RETURN_MS = 2 * 60_000;
const TOAST_ID = "livrables";
// The offer to turn on the computer's notifications, made once, with the first deliverable (Leslie, 16/11).
const INVITED_KEY = "yelema.notify-invited";

function invitedOnce(): boolean {
  try {
    if (localStorage.getItem(INVITED_KEY)) return true;
    localStorage.setItem(INVITED_KEY, "1");
    return false;
  } catch {
    return true;
  }
}

// « (2) Unifood » in the tab while it is hidden (Leslie, 16/11: on le voit depuis Gmail), back to the
// page's own title once the tab shows. Next sets the title on navigation, which only happens when shown.
const tabCount = { n: 0, title: "" };
function countInTab(n: number) {
  if (!tabCount.n) tabCount.title = document.title.replace(/^\(\d+\)\s*/, "");
  tabCount.n += n;
  document.title = `(${tabCount.n}) ${tabCount.title}`;
}
/** « (1) » in the tab title while it is hidden, cleared when it shows (an approval waiting, a deliverable ready). */
export const alertInTab = (n: number): void => countInTab(n);
function clearTabCount() {
  if (!tabCount.n) return;
  if (document.title.startsWith(`(${tabCount.n}) `)) document.title = tabCount.title;
  tabCount.n = 0;
}

export function DeliverableWatcher() {
  const agentId = useOwnAgentId();
  const { eventStream } = usePublicConfig();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const hiddenAt = useRef<number | null>(null);
  // What the pop-up on screen already announces: a new delivery joins it instead of piling up.
  const shown = useRef<DeliveryNotice[]>([]);

  const check = useCallback(
    async (maxAgeMs: number) => {
      if (!agentId) return;
      const tree = await driveTree(agentId, maxAgeMs).catch(() => null);
      // A folder that failed to list would read as files gone, then as new ones on the next pass.
      if (!tree || !tree.complete) return;
      // What the member brought is no deliverable of an Expert: never announced (Leslie, 30/10).
      const files = tree.entries.filter((e) => e.type === "file" && !e.hidden && !isDriveClutter(e) && !isMemberUpload(e.path));
      // An archived file is seen at its place outside « Archivées »: archived, then « Remettre », it is no
      // new deliverable. What sits in « Archivées » is never announced.
      const at = (path: string) => path.replace(`/${ARCHIVE_FOLDER}/`, "/");
      const before = seen.current;
      seen.current = new Set(files.map((f) => at(f.path)));
      if (!before || !readNotifyPrefs().deliverable) return;
      // Never a pile (Leslie, 30/10: « trop de pop-ups »): ONE pop-up for everything delivered while it
      // shows, replaced as more comes, swiped away or closed at once, with « Ne plus afficher ».
      const fresh = deliveryNotices(files.filter((f) => !isArchived(f.path) && !before.has(at(f.path))));
      if (!fresh.length) return;
      shown.current = [...shown.current.filter((n) => !fresh.some((f) => f.id === n.id)), ...fresh].slice(-MAX_SHOWN);
      const all = shown.current;
      const one = all.length === 1 ? all[0] : null;
      const count = all.reduce((n, d) => n + d.docs.length, 0);
      const title = one ? one.title : `${count} nouveaux livrables`;
      const text = all.map((n) => `${n.expert ? `${n.expert} : ` : ""}${n.docs.join(", ")}`).join("\n");
      // Several deliveries: one line per Expert, its name in bold, three at most (Leslie, 30/10 : « ça
      // doit rester clair, lisible et joli »).
      // Once, with a deliverable, while the browser may still ask: « Être prévenu même sur un autre onglet ? ».
      const invite = notificationSupport() === "default" && !invitedOnce() ? (
        <span className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-tint px-3 py-2 text-[13px] text-ink">
          <span className="font-semibold">Être prévenu même sur un autre onglet ?</span>
          <button
            type="button"
            onClick={() => void askNotificationPermission()}
            className="h-8 rounded-full bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand/90"
          >
            Activer
          </button>
        </span>
      ) : null;
      const list = one ? (
        one.description
      ) : (
        <ul className="mt-1 space-y-1">
          {all.slice(0, 3).map((n) => (
            <li key={n.id} className="line-clamp-2">
              {n.expert && <span className="font-semibold text-ink">{n.expert} </span>}
              {n.docs.join(", ")}
            </li>
          ))}
          {all.length > 3 && <li className="text-ink-3">et {all.length - 3} autres Experts</li>}
        </ul>
      );
      const description = invite ? (
        <>
          {list}
          {invite}
        </>
      ) : (
        list
      );
      const open = () =>
        router.push(one ? `${agentTabPath(agentId, "files")}?dossier=${encodeURIComponent(one.folder)}` : "/livrables");
      const reset = () => {
        shown.current = [];
      };
      const stop = () => {
        void saveNotifyPrefs({ ...readNotifyPrefs(), deliverable: false });
        toast("Plus de pop-up pour les livrables", { description: "Ils restent dans la cloche. À réactiver dans Paramètres, Notifications.", duration: 5000 });
      };
      toast(title, {
        id: TOAST_ID,
        // Text on the whole width, the two buttons under it (globals.css): readable on a phone.
        className: "toast-stack",
        description,
        action: { label: "Ouvrir", onClick: open },
        cancel: { label: "Ne plus afficher", onClick: stop },
        // Secondary to « Ouvrir »: a quiet text button.
        cancelButtonStyle: { background: "transparent", color: "var(--ink-3)", border: "none", boxShadow: "none" },
        duration: 8000,
        onDismiss: reset,
        onAutoClose: reset,
      });
      if (document.hidden) {
        countInTab(fresh.reduce((n, d) => n + d.docs.length, 0));
        systemNotify(title, text, TOAST_ID, open);
      }
    },
    [agentId, router]
  );

  useEffect(() => {
    seen.current = null;
  }, [agentId]);

  // Mount, the tab shown again, and the safety net; never while hidden.
  usePoll(() => check(60_000), { everyMs: SAFETY_MS, enabled: Boolean(agentId), live: true, minMs: 60_000, agentId });

  useEffect(() => {
    if (!agentId) return;
    // Read as soon as the drive changes, also while the tab is hidden: that is when the count in the tab and
    // the computer's notification are of use (Leslie, 16/11). The store already forgot its copy.
    const off = onDriveChanged(agentId, () => void check(60_000));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      clearTabCount();
      // With the stream, what happened while hidden comes back as events (replayed, or `instance.changed`).
      if (!eventStream && hiddenAt.current !== null && Date.now() - hiddenAt.current >= RETURN_MS) void check(0);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [agentId, check, eventStream]);

  return null;
}
