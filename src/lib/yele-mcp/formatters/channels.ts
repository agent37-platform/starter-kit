// Les canaux de l'équipe : Telegram, e-mail, et l'état de la passerelle de messagerie, mis en texte.
// Qui parle où est calculé dans ../summaries/channels.ts.

import { isChannelConnected } from "../../channels.ts";
import { expertRole, formatExpertDisplayName } from "../experts.ts";
import { masquerSecrets } from "../secrets.ts";
import { channelIndex, expertEmail } from "../summaries/channels.ts";
import type { ChannelState, DiscoveredExpert, MailConfig, TelegramConfig } from "../types.ts";

export function formatCanauxEtTelegram(
  tg: TelegramConfig | null,
  mail: MailConfig | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string,
  channels?: ChannelState[] | null
): string {
  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  const index = channelIndex(tg, mail);
  const { topicByExpert } = index;

  if (cleanTarget) {
    const topicId = topicByExpert[cleanTarget];
    const email = expertEmail(index, cleanTarget);
    const expMeta = experts?.find((e) => e.id.toLowerCase() === cleanTarget);
    const expName = expMeta ? formatExpertDisplayName(expMeta) : cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1);

    let out = `### 📱 Canaux de communication : ${expName}\n\n`;
    out += `- **🤖 Bot Telegram** : ${tg?.bot ? `\`@${tg.bot}\`${tg.botId ? ` (ID: \`${tg.botId}\`)` : ""}` : "non configuré"}\n`;
    out += `- **💬 Groupe Telegram (Forum)** : ${telegramGroup(tg)}\n`;
    out += `- **🧵 Topic / Fil de discussion dédié** : ${topicId ? `**Fil #${topicId}** (\`${cleanTarget}\`)` : "Non assigné"}\n`;
    if (tg?.inviteLink) {
      out += `- **🔗 Lien d'invitation au groupe** : ${tg.inviteLink}\n`;
    }
    out += `- **✉️ E-mail d'entreprise** : ${email ? `\`${email}\`` : "aucune adresse configurée"}\n`;
    out += channelsBlock(channels);
    return masquerSecrets(out);
  }

  let out = `### 📱 Canaux de Communication & Telegram de l'Équipe\n\n`;
  out += `- **💬 Groupe Telegram (Forum d'équipe)** : ${telegramGroup(tg)}\n`;
  out += `- **🤖 Bot Telegram** : ${tg?.bot ? `\`@${tg.bot}\` (phase : \`${tg.phase ?? "inconnue"}\`)` : "non configuré"}\n`;
  if (tg?.inviteLink) {
    out += `- **🔗 Lien d'invitation Telegram** : ${tg.inviteLink}\n`;
  }
  out += `- **✉️ Messagerie** : ${mail?.addresses && Object.keys(mail.addresses).length > 0 ? `${Object.keys(mail.addresses).length} adresse(s) configurée(s)` : "aucune adresse configurée"}\n\n`;

  out += `#### 🧵 Répartition des Fils Telegram & E-mails par Expert :\n\n`;
  out += `| Expert | Rôle | Topic Telegram | E-mail Professionnel |\n`;
  out += `| :--- | :--- | :---: | :--- |\n`;

  const list =
    experts && experts.length > 0
      ? experts
      : Object.keys(topicByExpert).map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), description: "" }));
  for (const exp of list) {
    const role = expertRole(exp);
    const topicId = topicByExpert[exp.id.toLowerCase()];
    const email = expertEmail(index, exp.id.toLowerCase());
    const topicStr = topicId ? `Fil #${topicId}` : "—";
    out += `| **${exp.name}** | ${role} | ${topicStr} | ${email ? `\`${email}\`` : "—"} |\n`;
  }

  out += channelsBlock(channels, "\n");
  return masquerSecrets(out);
}

// The team's Telegram group as read in telegram.json; nothing made up when it is not configured.
function telegramGroup(tg: TelegramConfig | null): string {
  if (!tg?.chatId && !tg?.chatTitle) return "non configuré";
  return `\`${tg.chatTitle ?? "sans titre"}\`${tg.chatId ? ` (ID: \`${tg.chatId}\`)` : ""}`;
}

// The channels of the instance's messaging gateway, as it answers now: nothing when not asked
// (undefined), a sentence when it could not be read (null).
function channelsBlock(channels: ChannelState[] | null | undefined, before = ""): string {
  if (channels === undefined) return "";
  let out = `${before}#### 📡 Canaux de la passerelle (état lu sur l'instance) :\n`;
  if (channels === null) return out + `- État illisible pour le moment.\n`;
  if (channels.length === 0) return out + `- Aucun canal configuré.\n`;
  for (const c of channels) {
    const state = isChannelConnected(c) ? "🟢 connecté" : c.enabled ? "⚠️ activé, non connecté" : "⚪ désactivé";
    out += `- ${c.name} : ${state}\n`;
  }
  return out;
}
