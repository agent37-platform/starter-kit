// The e-mail an approval is about, read from its text (Leslie, 19/11: « faire valider visuellement à quoi ça
// ressemblerait » before an Expert sends; RETEX Unifood: two sendings lost because nobody saw the card).
// The guard of the image writes the action on the first line, then optional « Champ : valeur » lines
// (À, Cc, Cci, Objet, Pièces jointes, À vérifier), a blank line, and the text. No imports: tested.

export interface MailPreview {
  to: string[];
  cc: string[];
  subject: string | null;
  attachments: string[];
  /** Recipients the Expert is not sure of, with why (« Soraya Abj : rapprochée par déduction »). */
  doubts: string | null;
  body: string | null;
}

const SEND = /^(?:Envoyer un e-mail depuis la boîte de votre expert à|Envoyer un message avec (?:Gmail|Outlook) :)\s*(.+)$/i;
const list = (v: string) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

/** The e-mail an approval sends, or null when the approval is not an e-mail sending. */
export function mailPreview(message: string): MailPreview | null {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  const head = SEND.exec(lines[0]?.trim() ?? "");
  if (!head) return null;
  const out: MailPreview = { to: list(head[1]), cc: [], subject: null, attachments: [], doubts: null, body: null };
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break;
    const m = /^(À|A|Cc|Cci|Objet|Pièces? jointes?|PJ|À vérifier)\s*:\s*(.*)$/i.exec(line);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key === "à" || key === "a") out.to = list(m[2]);
    else if (key === "cc" || key === "cci") out.cc.push(...list(m[2]));
    else if (key === "objet") out.subject = m[2].trim() || null;
    else if (key.startsWith("pi") || key === "pj") out.attachments = list(m[2]);
    else out.doubts = m[2].trim() || null;
  }
  const body = lines.slice(i).join("\n").trim();
  out.body = body || null;
  return out;
}
