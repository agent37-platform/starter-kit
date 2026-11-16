"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { RelayChannel as Channel, RelayLink, RelayStatus } from "@/lib/agent37";
import { DisconnectButton } from "@/components/channels/DisconnectButton";
import { StatePill } from "@/components/integrations/StatePill";

const LABELS: Record<Channel, { title: string; intro: string; install: string }> = {
  slack: { title: "Slack", intro: "Écrivez à vos Experts en message direct au bot Yelema, ou mentionnez-le dans un canal.", install: "Ajouter à Slack" },
  teams: { title: "Microsoft Teams", intro: "Écrivez à vos Experts depuis Teams, en message privé ou dans vos équipes.", install: "Ouvrir Yelema dans Teams" },
  telegram: { title: "Telegram", intro: "Écrivez à vos Experts en message privé au bot de votre équipe, depuis votre compte Telegram.", install: "Ouvrir le bot de l’équipe" },
};
const SAFE = /^https:\/\/(slack\.com|teams\.microsoft\.com|t\.me)\//;

// Slack ou Teams d'une instance Claude Code : l'application Yelema du canal, installée une fois par
// l'entreprise, puis chaque membre relie son compte en envoyant au bot le code montré ici. Le nom de l'expert
// en tête du message choisit à qui l'on parle.
export function RelayChannel({ agentId, channel, canManage }: { agentId: string; channel: Channel; canManage: boolean }) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [link, setLink] = useState<RelayLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = `/api/agents/${agentId}/channels/relay/${channel}`;
  const l = LABELS[channel];

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<RelayStatus>(base));
    } catch {
      setStatus({ enabled: false, accounts: 0 });
    }
  }, [base]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const connect = () => act(async () => setLink(await apiFetch<RelayLink>(base, { method: "POST" })));
  const unlink = () =>
    act(async () => {
      await apiFetch(base, { method: "DELETE" });
      toast.success(`${l.title} déconnecté`);
      setLink(null);
      await load();
    });
  const install = link?.installUrl ?? link?.appUrl ?? link?.botUrl ?? null;

  if (!status) return <div className="h-20 animate-pulse rounded-lg border bg-card" />;
  // Slack and Teams are not tested yet with clients (Leslie, 16/11): « Bientôt » until an account is linked.
  if (channel !== "telegram" && !status.accounts)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">{l.title}</p>
          <p className="text-xs text-muted-foreground">{l.intro}</p>
        </div>
        <StatePill state="soon" />
      </div>
    );
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{l.title}</p>
          <p className="text-xs text-muted-foreground">{status.enabled ? (status.accounts ? `${status.accounts} ${status.accounts > 1 ? "comptes reliés" : "compte relié"} à cet espace.` : l.intro) : `${l.title} n’est pas encore disponible pour votre entreprise.`}</p>
        </div>
        {canManage && status.enabled && (
          <div className="flex gap-2">
            <Button variant={status.accounts ? "outline" : "default"} onClick={() => void connect()} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {status.accounts ? "Relier un autre compte" : `Connecter ${l.title}`}
            </Button>
            {status.accounts > 0 && <DisconnectButton name={l.title} onConfirm={unlink} disabled={busy} />}
          </div>
        )}
      </div>
      {link?.createUrl && SAFE.test(link.createUrl) && (
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>
            <a className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" href={link.createUrl} target="_blank" rel="noopener noreferrer">Créer le bot de l’équipe <ExternalLink className="h-3 w-3" /></a>{" "}
            (une seule fois pour l’équipe ; vous êtes relié d’office).
          </li>
          <li>Écrivez-lui ensuite en commençant par le nom d’un Expert (« Mamadou, … »). Vos collègues le relient depuis cette page.</li>
        </ol>
      )}
      {link?.code && (
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          {install && SAFE.test(install) && (
            <li>
              <a className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" href={install} target="_blank" rel="noopener noreferrer">{l.install} <ExternalLink className="h-3 w-3" /></a>
              {channel === "slack" ? " (une fois par entreprise ; celui qui installe est relié d’office)." : channel === "teams" ? " (votre administrateur Teams doit avoir ajouté l’application Yelema)." : "."}
            </li>
          )}
          <li>
            Envoyez au bot Yelema :{" "}
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold text-foreground">
              lier {link.code}
              <button type="button" aria-label="Copier" onClick={() => void navigator.clipboard.writeText(`lier ${link.code}`).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </span>{" "}
            (valable 15 minutes).
          </li>
          <li>Pour écrire à un Expert, commencez votre message par son nom (« Djénéba, … »).</li>
        </ol>
      )}
    </div>
  );
}
