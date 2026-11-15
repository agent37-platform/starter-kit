// The members' « Échanges » (internal messaging), as the back office describes it (`GET /api/v1/app/buzz`): the client's relay,
// the member's own devices, the directory (people and their experts) and the team salons. Messages
// themselves never pass through the back office: the browser reads and writes them on the relay.

/** `profil` (experts): their Hermes profile; `photo` is added by this app from the catalogue. */
export interface BuzzEntry { nom: string; type: "personne" | "expert"; membre: string; cles: string[]; profil?: string; photo?: string | null }
export interface BuzzOverview {
  relais: string;
  appareils: { cle: string; nom: string }[];
  annuaire: BuzzEntry[];
  salons: { id: string; nom: string }[];
}

export const PUBKEY_RE = /^[0-9a-f]{64}$/;
/** Buzz: 9 participants at most in a direct conversation, the sender included. */
export const MAX_RECIPIENTS = 8;

/** Who a key is: « Mamadou (de Leslie) », or a person's name for one of their devices. */
export function labelsOf(directory: BuzzEntry[]): Map<string, string> {
  return new Map(directory.flatMap((e) => e.cles.map((k): [string, string] => [k, e.nom])));
}

/** A direct conversation is named by the people in it other than oneself. */
export function conversationName(members: string[], mine: string[], labels: Map<string, string>, fallback: string): string {
  const others = [...new Set(members.filter((m) => !mine.includes(m)).map((m) => labels.get(m)).filter((n): n is string => Boolean(n)))];
  return others.length ? others.join(", ") : fallback;
}

/** Buzz names a direct conversation « DM » or « Group DM (3) »; any other named channel is a salon. */
export const isSalonName = (name: string): boolean => !/^(group )?dm( \(\d+\))?$/i.test(name.trim()) && name !== "Conversation";

/** Who is in a conversation, as people read it: one « vous » for all one's devices, unknown keys (the relay) left out. */
export function participants(members: string[], mine: string[], labels: Map<string, string>): string[] {
  return [...new Set(members.map((k) => (mine.includes(k) ? "vous" : labels.get(k))).filter((v): v is string => Boolean(v)))];
}

export interface DirectoryPerson { membre: string; nom: string; self: boolean; person: BuzzEntry | null; experts: BuzzEntry[] }

/** The directory by member: the person (when reachable) and their experts; oneself first, for one's own experts. */
export function peopleOf(directory: BuzzEntry[], mine: string[]): DirectoryPerson[] {
  const byMember = new Map<string, DirectoryPerson>();
  for (const e of directory) {
    const self = e.type === "personne" && e.cles.length > 0 && e.cles.every((k) => mine.includes(k));
    const row = byMember.get(e.membre) ?? { membre: e.membre, nom: e.nom, self: false, person: null, experts: [] };
    if (e.type === "personne") Object.assign(row, { nom: e.nom, self, person: e.cles.length && !self ? e : null });
    else row.experts.push(e);
    byMember.set(e.membre, row);
  }
  return [...byMember.values()].filter((p) => p.person || p.experts.length).sort((a, b) => Number(b.self) - Number(a.self) || a.nom.localeCompare(b.nom, "fr"));
}

/** The caller's own member id in the directory (the person whose devices are all mine), or null. */
export function myMember(directory: BuzzEntry[], mine: string[]): string | null {
  return directory.find((e) => e.type === "personne" && e.cles.length > 0 && e.cles.every((k) => mine.includes(k)))?.membre ?? null;
}

/** My experts present in a salon: the only ones I can ask for work there. */
export function myExpertsIn(directory: BuzzEntry[], mine: string[], members: string[]): BuzzEntry[] {
  const me = myMember(directory, mine);
  return me ? directory.filter((e) => e.type === "expert" && e.membre === me && e.cles.some((k) => members.includes(k))) : [];
}

/** Experts still on a request: mentioned by me in a message they have not answered since. */
export function working(thread: { author: string; at: number; mentions: string[] }[], mine: string[], experts: BuzzEntry[]): BuzzEntry[] {
  return experts.filter((e) => {
    const asked = thread.filter((m) => mine.includes(m.author) && m.mentions.some((k) => e.cles.includes(k))).at(-1);
    return asked !== undefined && !thread.some((m) => m.at >= asked.at && e.cles.includes(m.author));
  });
}

/** An expert's name without its owner: « Djénéba (de Selim T) » → « Djénéba ». */
export const shortName = (nom: string): string => nom.replace(/ \(de .*\)$/, "");

/** Each entry with its portrait (experts only), from a lookup by profile. */
export function withPhotos(directory: BuzzEntry[], photoOf: (profil: string) => string | null): BuzzEntry[] {
  return directory.map((e) => (e.type === "expert" && e.profil ? { ...e, photo: photoOf(e.profil) } : e));
}

export interface SalonGroup { membre: string; nom: string; self: boolean; person: BuzzEntry | null; experts: BuzzEntry[] }

/** Who is in a salon, by member: the person (if one of their keys is in it) and their experts there; oneself first. */
export function salonPeople(directory: BuzzEntry[], members: string[], mine: string[]): SalonGroup[] {
  const me = myMember(directory, mine);
  const inIt = (e: BuzzEntry) => e.cles.some((k) => members.includes(k));
  const groups = new Map<string, SalonGroup>();
  const group = (e: BuzzEntry) => groups.get(e.membre) ?? groups.set(e.membre, { membre: e.membre, nom: e.nom, self: e.membre === me, person: null, experts: [] }).get(e.membre)!;
  for (const e of directory) if (e.type === "personne") group(e).nom = e.nom;
  for (const e of directory.filter(inIt)) {
    if (e.type === "personne") group(e).person = e;
    else group(e).experts.push(e);
  }
  if (me && mine.some((k) => members.includes(k))) groups.get(me)!.person ??= directory.find((e) => e.type === "personne" && e.membre === me) ?? null;
  return [...groups.values()].filter((g) => g.person || g.experts.length).sort((a, b) => Number(b.self) - Number(a.self) || a.nom.localeCompare(b.nom, "fr"));
}

/** Whether a message opens a run: its author differs from the previous one's, or more than 5 minutes passed. */
export function startsRun(prev: { author: string; at: number } | undefined, m: { author: string; at: number }): boolean {
  return !prev || prev.author !== m.author || m.at - prev.at > 5 * 60;
}
