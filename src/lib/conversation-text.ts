import { cleanReply, cleanUserMessage } from "./chat-errors.ts";
import type { ChatHistoryMessage } from "./types.ts";
import { toMs } from "./activity.ts";
import { visibleHistory } from "./compaction.ts";

// A conversation as plain text, to paste to a colleague or a developer: the title, then each
// message with who wrote it and when. Replies are cleaned like on screen (the runtime's English
// lines out), the rows the thread hides (compaction notes, replays) too, system rows and empty messages are left out.
const when = (at: number) =>
  new Date(toMs(at)).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function conversationText(title: string, expert: string, history: ChatHistoryMessage[]): string {
  const blocks = visibleHistory(history)
    .filter((m) => m.role !== "system")
    .map((m) => ({ ...m, content: m.role === "assistant" ? cleanReply(m.content ?? "") : cleanUserMessage(m.content ?? "") }))
    .filter((m) => m.content)
    .map((m) => `${m.role === "user" ? "Vous" : expert}${m.created_at ? `, ${when(m.created_at)}` : ""}\n${m.content}`);
  return [`${title} (conversation avec ${expert})`, ...blocks].join("\n\n");
}
