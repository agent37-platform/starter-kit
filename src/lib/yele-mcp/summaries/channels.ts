// Qui parle où : le fil Telegram et l'adresse e-mail de chaque expert, indexés par id. Pas de texte ici.
import type { MailConfig, TelegramConfig } from "../types.ts";

export interface ChannelIndex {
  /** id d'expert (en minuscules) → numéro de son fil dans le forum Telegram. */
  topicByExpert: Record<string, string>;
  /** id d'expert (en minuscules) → son adresse e-mail déclarée. */
  mailByExpert: Record<string, string>;
}

export function channelIndex(tg: TelegramConfig | null, mail: MailConfig | null): ChannelIndex {
  const topicByExpert: Record<string, string> = {};
  for (const [topicId, expId] of Object.entries(tg?.topics ?? {})) topicByExpert[String(expId).toLowerCase()] = topicId;

  const mailByExpert: Record<string, string> = {};
  for (const [expId, addr] of Object.entries(mail?.addresses ?? {})) mailByExpert[String(expId).toLowerCase()] = addr;

  return { topicByExpert, mailByExpert };
}

/** L'adresse e-mail d'un expert (id en minuscules), telle que déclarée dans mail.json ; aucune sinon. */
export function expertEmail(index: ChannelIndex, expId: string): string | undefined {
  return index.mailByExpert[expId];
}
