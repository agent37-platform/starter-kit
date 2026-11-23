// A conversation's name in the list, in French. Hermes names a conversation opened by a command in
// English (« Run tableau command #4 »): the member reads what it was for (Leslie, 29/10).
const COMMANDS: Record<string, string> = {
  tableau: "Tableau de bord",
  // The three commands the empty conversation runs behind plain words (Leslie, 31/10).
  onboarding: "Bien démarrer",
  memoire: "Sa mémoire",
  configuration: "Ses outils",
};

// « Run tableau command #4 », and since 03/11 « /tableau #3 » (Leslie's screenshot).
const COMMAND_TITLE = /^(?:Run \/?([\w-]+) command|\/([\w-]+))(?: #\d+)?$/i;
const COMMAND_PREVIEW = /^\/([\w-]+)\s*$/;

export function sessionTitle(title: string | null | undefined, preview: string | null | undefined): string | null {
  const t = title?.trim() || "";
  const p = preview?.trim() || "";
  const named = COMMAND_TITLE.exec(t);
  const command = (named?.[1] ?? named?.[2]) ?? (!t ? COMMAND_PREVIEW.exec(p)?.[1] : undefined);
  if (command) return COMMANDS[command.toLowerCase()] ?? `Commande ${command.toLowerCase()}`;
  return t || p || null;
}

/**
 * A message that is a bare command the app sent for the member (« /onboarding »), in the words of its
 * button; any other text as is. The member never reads a command (Leslie, 31/10).
 */
export function commandText(content: string, pronoun: "il" | "elle" | null = null): string {
  const name = COMMAND_PREVIEW.exec(content.trim())?.[1]?.toLowerCase();
  if (!name || !(name in COMMANDS)) return content;
  if (name === "memoire") return pronoun === "il" ? "Ce qu’il sait" : pronoun === "elle" ? "Ce qu’elle sait" : "Sa mémoire";
  return COMMANDS[name];
}
