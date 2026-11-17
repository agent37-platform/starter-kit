// « Envoyer » (Leslie, 17/11): the accounts a deliverable can really leave from, and the instruction the
// expert gets. Only what is plugged in is offered: the member's Gmail or Outlook (Yelema's Composio), the
// expert's own address when the member may make it send, the member's WhatsApp, LinkedIn or mail through
// Unipile when this expert reaches it. Nothing else is suggested. Pure, so `node --test` runs it as is.
import { accountState, accountTitle, accountsBySlug } from "./connection-accounts.ts";
import type { IntegrationConnection } from "./types";
import { accountName } from "./unipile.ts";

export type SendChannel = "mail" | "whatsapp" | "linkedin";

export interface SendAccount {
  /** Stable within one listing: `composio:<id>`, `agentmail`, `unipile:<id>`. */
  id: string;
  channel: SendChannel;
  /** « Votre Gmail », « L’adresse d’Awa », « Votre WhatsApp ». */
  title: string;
  /** The address or number it sends from, when known. */
  detail: string | null;
  /** How the expert is told to send, in its own words. */
  how: string;
}

export interface SendSources {
  /** The instance's connectors (any state; only active ones are kept). */
  connections: readonly IntegrationConnection[] | null;
  /** The expert's own inbox, when the member has one for it. */
  inbox: { address: string; sendEnabled: boolean; canSend: boolean } | null;
  /** The member's Unipile messaging, as `/api/unipile` reads it. */
  unipile: { connected: boolean; experts: string[]; accounts: { id: string; type: string; name: string; status: string | null }[] } | null;
  /** The expert (profile id) the instruction goes to. */
  profileId: string | null;
  expertName: string;
}

const COMPOSIO_MAIL: Record<string, string> = { gmail: "Gmail", outlook: "Outlook" };
const UNIPILE: Record<string, { channel: SendChannel; name: string }> = {
  WHATSAPP: { channel: "whatsapp", name: "WhatsApp" },
  LINKEDIN: { channel: "linkedin", name: "LinkedIn" },
  GOOGLE: { channel: "mail", name: "Gmail" },
  GOOGLE_OAUTH: { channel: "mail", name: "Gmail" },
  OUTLOOK: { channel: "mail", name: "Outlook" },
  MAIL: { channel: "mail", name: "e-mail" },
  IMAP: { channel: "mail", name: "e-mail" },
};
const BROKEN = new Set(["CREDENTIALS", "ERROR", "STOPPED", "DISCONNECTED"]);

/** Every account the expert can send from now, e-mail first, then WhatsApp, then LinkedIn. */
export function sendAccounts(s: SendSources): SendAccount[] {
  const out: SendAccount[] = [];
  for (const [slug, name] of Object.entries(COMPOSIO_MAIL)) {
    const list = (accountsBySlug(s.connections ?? []).get(slug) ?? []).filter((c) => accountState(c) === "active");
    list.forEach((c, i) => {
      const title = accountTitle(c, i);
      const detail = c.email || (title.includes("@") ? title : null);
      out.push({
        id: `composio:${c.id}`,
        channel: "mail",
        title: `Votre ${name}`,
        detail: detail ?? (list.length > 1 ? title : null),
        how: `avec l’outil ${name} connecté${detail ? ` (compte ${detail})` : ""}`,
      });
    });
  }
  if (s.inbox?.sendEnabled && s.inbox.canSend) {
    out.push({
      id: "agentmail",
      channel: "mail",
      title: `L’adresse ${/^[aeiouyhàâéèêëîïôöûü]/i.test(s.expertName) ? "d’" : "de "}${s.expertName}`,
      detail: s.inbox.address,
      how: `depuis ta propre adresse ${s.inbox.address}`,
    });
  }
  const u = s.unipile;
  if (u?.connected && s.profileId && u.experts.includes(s.profileId)) {
    for (const a of u.accounts) {
      const kind = UNIPILE[a.type.trim().toUpperCase()];
      if (!kind || BROKEN.has((a.status ?? "").toUpperCase())) continue;
      const shown = a.name ? accountName(a) : null;
      out.push({
        id: `unipile:${a.id}`,
        channel: kind.channel,
        title: `Votre ${kind.name}`,
        detail: shown,
        how: `avec Unipile, depuis mon compte ${kind.name}${shown ? ` « ${shown} »` : ""}`,
      });
    }
  }
  const rank: Record<SendChannel, number> = { mail: 0, whatsapp: 1, linkedin: 2 };
  return out.sort((a, b) => rank[a.channel] - rank[b.channel]);
}

const CHANNEL_WORDS: Record<SendChannel, string> = { mail: "par e-mail", whatsapp: "par WhatsApp", linkedin: "par message LinkedIn" };

/** « moi-même » made the member's real address on e-mail; other people as typed. */
export function recipientList(me: boolean, myEmail: string | null, others: string, channel: SendChannel): string[] {
  const list: string[] = [];
  // On WhatsApp or LinkedIn the account is the member's own: « moi-même » means nothing there.
  if (me && channel === "mail") list.push(myEmail || "moi-même");
  for (const part of others.split(/[,;\n]+/)) if (part.trim()) list.push(part.trim());
  return [...new Set(list)];
}

function joinFr(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

/** Written only by the « Envoyer » window: the member's click there is their agreement to that sending. */
export const SEND_SIGNATURE = "Utilise ce compte et aucun autre.";
export const isDialogSend = (text: string): boolean => /^\s*envoie\s/i.test(text) && text.includes(SEND_SIGNATURE);

/** The instruction for files sent now: who, from which account, the exact files, and a proof back. */
export function sendFilesText(files: readonly { name: string; path: string }[], to: string[], account: SendAccount): string {
  const what = files.length === 1 ? "ce livrable" : `ces ${files.length} livrables`;
  const attach = account.channel === "mail" ? ", en pièces jointes" : "";
  return [
    `Envoie ${what} à ${joinFr(to)} ${CHANNEL_WORDS[account.channel]}, ${account.how}${attach} :`,
    ...files.map((f) => `- ${f.path}`),
    "",
    `${SEND_SIGNATURE} Une fois envoyé, dis-moi à qui et à quelle heure ; si l’envoi échoue, dis-moi pourquoi.`,
  ].join("\n");
}

/** The standing instruction of an automatic sending. */
export function sendRoutineText(what: "each" | "minutes", to: string[], account: SendAccount, ask: boolean): string {
  const head =
    what === "each"
      ? `Nouvelle routine d’envoi : dès qu’un livrable est prêt, envoie-le à ${joinFr(to)} ${CHANNEL_WORDS[account.channel]}, ${account.how}.`
      : `Nouvelle routine d’envoi : après chaque rendez-vous, envoie le compte rendu à ${joinFr(to)} ${CHANNEL_WORDS[account.channel]}, ${account.how}.`;
  return `${head} ${ask ? "Demande-moi avant chaque envoi." : "Envoie sans me demander."} Garde cette consigne jusqu’à ce que je te dise d’arrêter.`;
}
