"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiFetchError } from "@/lib/api";
import { isCompanionProfile } from "@/lib/companion";
import { expertDisplayName } from "@/lib/experts";
import { INBOX_LIMIT_CODE, moreInboxesHref, type MailInbox } from "@/lib/mail";
import type { WorkspaceInstance } from "@/lib/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { useCatalogue } from "@/components/experts/useCatalogue";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/WorkspaceProvider";

// For admins: the address of each expert of a member's instance, given or taken back. A member is named
// by e-mail (the app shows no one else's instance id); the back office checks the role again and never
// lets an admin read a colleague's mail.

export function MemberInboxes() {
  const { current } = useWorkspace();
  const { catalogue } = useCatalogue(current?.id);
  const [members, setMembers] = useState<{ email: string; experts: string[] }[] | null>(null);
  const [member, setMember] = useState("");
  const [inboxes, setInboxes] = useState<MailInbox[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [closing, setClosing] = useState<MailInbox | null>(null);
  const entry = (key: string) => catalogue.experts.find((e) => e.key === key);
  const nameOf = (key: string) => entry(key)?.name ?? expertDisplayName(key);
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({ member, ...extra }).toString();

  useEffect(() => {
    if (current?.role !== "admin") return;
    apiFetch<{ instances: WorkspaceInstance[] }>(`/api/workspaces/${current.id}/instances`)
      .then(({ instances }) => {
        const list = instances.flatMap((i) => (i.member_email ? [{ email: i.member_email, experts: (i.experts ?? []).filter((e) => !isCompanionProfile(e)) }] : []));
        setMembers(list);
        setMember((m) => m || list[0]?.email || "");
      })
      .catch((e: Error) => toast.error(e.message));
  }, [current?.id, current?.role]);

  useEffect(() => {
    if (!member) return;
    setInboxes(null);
    apiFetch<{ items: MailInbox[] }>(`/api/mail/inboxes?${new URLSearchParams({ member }).toString()}`)
      .then((d) => setInboxes(d.items))
      .catch((e: Error) => toast.error(e.message));
  }, [member]);

  async function give(expert: string) {
    setBusy(expert);
    try {
      const { inbox } = await apiFetch<{ inbox: MailInbox }>("/api/mail/inboxes", { method: "POST", body: JSON.stringify({ expert, member }) });
      setInboxes((list) => [...(list ?? []).filter((i) => i.expert !== expert), inbox]);
      toast.success(`Adresse attribuée : ${inbox.address}`);
    } catch (e) {
      // None left: the sentence, and a way to ask Yelema's team for more (Leslie, 18/11).
      if (e instanceof ApiFetchError && e.code === INBOX_LIMIT_CODE) {
        const href = moreInboxesHref(current?.name ?? null, nameOf(expert));
        toast.error(e.message, { duration: 12_000, action: { label: "Contacter Yelema", onClick: () => window.open(href, "_self") } });
      } else toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (current?.role !== "admin" || members?.length === 0) return null;
  const experts = members?.find((m) => m.email === member)?.experts ?? [];

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-ink">Adresses des Experts, par membre</h2>
      {!members ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin text-ink-3" aria-label="Chargement" />
      ) : (
        <>
          <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Membre" className="mt-3 h-11 w-full max-w-md rounded-full border border-line bg-surface px-4 text-sm text-ink">
            {members.map((m) => (
              <option key={m.email} value={m.email}>{m.email}</option>
            ))}
          </select>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[22px] border border-line bg-surface">
            {experts.map((key) => {
              const inbox = inboxes?.find((i) => i.expert === key) ?? null;
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <ExpertAvatar expert={{ displayName: nameOf(key), gateway: null, photoUrl: entry(key)?.avatarUrl ?? null }} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{nameOf(key)}</p>
                    <p className="truncate text-xs text-ink-3">{inboxes === null ? "…" : (inbox?.address ?? "Pas d’adresse")}</p>
                  </div>
                  {inboxes !== null &&
                    (inbox ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy === key} onClick={() => setClosing(inbox)}>Retirer</Button>
                    ) : (
                      <Button type="button" size="sm" disabled={busy === key} onClick={() => void give(key)}>
                        {busy === key && <Loader2 className="animate-spin" />}Attribuer
                      </Button>
                    ))}
                </li>
              );
            })}
            {experts.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-3">Aucun Expert sur cette instance.</li>}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(o) => !o && setClosing(null)}
        title={closing ? `Retirer l’adresse de ${nameOf(closing.expert)} ?` : ""}
        description={closing ? `${closing.address} ne recevra et n’enverra plus rien. Sa boîte est supprimée définitivement dans 30 jours ; d’ici là, l’attribuer de nouveau la rouvre telle quelle.` : undefined}
        confirmText="Retirer l’adresse"
        destructive
        onConfirm={async () => {
          if (!closing) return;
          await apiFetch(`/api/mail/inboxes?${query({ expert: closing.expert })}`, { method: "DELETE" });
          setInboxes((list) => (list ?? []).filter((i) => i.expert !== closing.expert));
          toast.success("Adresse e-mail retirée.");
        }}
      />
    </section>
  );
}
