const escapeHtml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Le texte d'un e-mail d'expert lu comme un Markdown léger et rendu en HTML à l'envoi : lignes coupées recollées,
// titres courts, **gras**, puces, [libellé](url), lien nu posé sur un libellé. Tout est échappé. Même rendu que le back-office (yelema-platform, mailFormat.ts) ; pur, pour `node --test`.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#1f1d2b';
const LINK = '#2e4ec4';

const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;
const ORDERED = /^\s*\d{1,2}[.)]\s+/;
const URL_ONLY = /^\s*<?https?:\/\/\S+>?\s*$/;
const HEADING_MD = /^\s*#{1,4}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\s*\*\*(.+?)\*\*\s*:?\s*$/;
const ENDS_SENTENCE = /[.!?:;,…»)"]$/;
const ENDS_LINE = /[.!?:…]$/;

type Block = { kind: 'p'; lines: string[] } | { kind: 'h'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

/** Une ligne coupée par l'expert (longue, sans fin de phrase) se recolle à la suivante ; une ligne courte ou finie garde son retour. */
function joins(prev: string): boolean {
  const p = prev.trim();
  return p.length >= 40 && !ENDS_LINE.test(p) && !URL_ONLY.test(p);
}

function blocks(text: string): Block[] {
  const paras = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').split(/\n\s*\n+/).map((b) => b.split('\n').filter((l) => l.trim() !== '')).filter((b) => b.length > 0);
  const out: Block[] = [];
  paras.forEach((lines, i) => {
    const last = i === paras.length - 1;
    const one = lines.length === 1 ? lines[0].trim() : null;
    const md = one ? (HEADING_MD.exec(one) ?? BOLD_LINE.exec(one)) : null;
    if (md) return void out.push({ kind: 'h', text: md[1] });
    // Ligne courte seule sans ponctuation finale = titre, sauf en dernier (la signature).
    if (one && !last && one.length <= 60 && !ENDS_SENTENCE.test(one) && !BULLET.test(one) && !URL_ONLY.test(one) && /\p{L}/u.test(one)) return void out.push({ kind: 'h', text: one });

    let current = null as Block | null;
    for (const raw of lines) {
      if (BULLET.test(raw)) {
        const kind = ORDERED.test(raw) ? 'ol' : 'ul';
        if (current?.kind !== kind) out.push((current = { kind, items: [] }));
        (current as { items: string[] }).items.push(raw.replace(BULLET, '').trim());
      } else if (current && (current.kind === 'ul' || current.kind === 'ol')) {
        // Suite d'une puce coupée.
        current.items[current.items.length - 1] += ' ' + raw.trim();
      } else {
        if (current?.kind !== 'p') out.push((current = { kind: 'p', lines: [] }));
        const p = current as { lines: string[] };
        if (p.lines.length > 0 && joins(p.lines[p.lines.length - 1])) p.lines[p.lines.length - 1] += ' ' + raw.trim();
        else p.lines.push(raw.trim());
      }
    }
  });
  return out;
}

/** Le libellé d'un lien nu : ce qu'il ouvre, jamais l'adresse entière. */
export function linkLabel(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname;
  if (host === 'docs.google.com') {
    if (path.startsWith('/presentation')) return 'Ouvrir la présentation';
    if (path.startsWith('/spreadsheets')) return 'Ouvrir le tableur';
    if (path.startsWith('/document')) return 'Ouvrir le document';
    if (path.startsWith('/forms')) return 'Ouvrir le formulaire';
  }
  if (host === 'drive.google.com') return path.includes('/folders/') ? 'Ouvrir le dossier' : 'Ouvrir le fichier';
  if (/(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com)$/.test(host)) return 'Rejoindre la réunion';
  if (/(^|\.)calendly\.com$/.test(host)) return 'Choisir un créneau';
  const rest = path === '/' ? '' : path.length > 24 ? path.slice(0, 22) + '…' : path;
  return host + rest;
}

const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /<?(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?»"'])>?/g;
const anchor = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${LINK};font-weight:600;text-decoration:underline">${escapeHtml(label)}</a>`;
const strong = (s: string) => `<strong style="font-weight:700">${s}</strong>`;

/** Une ligne en HTML : liens (Markdown ou nus, posés sur un libellé), gras, et « Nom : » de tête en gras. */
function inline(text: string, lead: boolean): string {
  const links: string[] = [];
  const hold = (html: string) => `\u0000${String(links.push(html) - 1)}\u0000`;
  let s = text.replace(MD_LINK, (_, label: string, href: string) => hold(anchor(href, label))).replace(BARE_URL, (_, href: string) => hold(anchor(href, linkLabel(href))));
  s = escapeHtml(s)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, (_, b: string) => strong(b))
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, (_, b: string) => strong(b));
  if (lead && !s.startsWith('<strong')) s = s.replace(/^([^:<\u0000]{2,32}?)\s:\s(?=\S)/u, (_, k: string) => `${strong(k)} : `);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)]);
}

const P = `margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${INK}`;
const H = `margin:22px 0 8px 0;font-size:16px;line-height:1.35;font-weight:700;color:${INK}`;
const LIST = `margin:0 0 14px 0;padding:0 0 0 22px;font-size:15px;line-height:1.6;color:${INK}`;

/** Le HTML d'un e-mail d'expert, en colonne de lecture de 600 px. */
export function mailHtml(text: string): string {
  const body = blocks(text)
    .map((b, i) => {
      if (b.kind === 'h') return `<h3 style="${i === 0 ? H.replace('22px', '0') : H}">${inline(b.text, false)}</h3>`;
      if (b.kind === 'p') return `<p style="${P}">${b.lines.map((l) => inline(l, true)).join('<br>')}</p>`;
      return `<${b.kind} style="${LIST}">${b.items.map((it) => `<li style="margin:0 0 6px 0">${inline(it, true)}</li>`).join('')}</${b.kind}>`;
    })
    .join('\n');
  return `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};max-width:600px">\n${body}\n</div>`;
}

/** La version texte qui l'accompagne : mêmes paragraphes recollés, sans balisage, un lien suivi de son adresse. */
export function mailText(text: string): string {
  const plain = (s: string) => s.replace(MD_LINK, '$1 ($2)').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  return blocks(text)
    .map((b) => (b.kind === 'h' ? plain(b.text) : b.kind === 'p' ? b.lines.map(plain).join('\n') : b.items.map((it, n) => `${b.kind === 'ol' ? `${String(n + 1)}.` : '-'} ${plain(it)}`).join('\n')))
    .join('\n\n');
}
