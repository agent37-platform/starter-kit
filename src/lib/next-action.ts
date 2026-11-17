// « La prochaine action » (Kirane, Leslie 16/11): at the end of a deliverable, the Expert offers to send it.
// To whom first: the person the member named in the request (« c'est pour Moussa »), else the member.
// Pure and without imports, so `node --test` runs it as it is.

// Capitalised words after « pour » or « à » that are no person: networks, tools, places, days, months.
const NOT_A_PERSON = new Set(
  [
    "facebook", "instagram", "linkedin", "whatsapp", "tiktok", "twitter", "youtube", "google", "gmail", "outlook", "excel", "word",
    "powerpoint", "canva", "notion", "slack", "teams", "drive", "pdf", "yelema", "moi", "nous", "vous", "eux", "elle", "lui", "tous",
    "abidjan", "dakar", "paris", "lomé", "lome", "cotonou", "bamako", "ouagadougou", "accra", "lagos", "douala", "yaoundé", "brazzaville",
    "kinshasa", "conakry", "niamey", "libreville", "noël", "noel", "pâques", "paques", "tabaski", "ramadan",
    "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "janvier", "février", "fevrier", "mars", "avril", "mai",
    "juin", "juillet", "août", "aout", "septembre", "octobre", "novembre", "décembre", "decembre",
  ].map((w) => w.normalize("NFC"))
);

const NAME = "[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{1,24}";
const CITED = new RegExp(`(?:^|[\\s,(])(?:pour|à|a|avec)\\s+(${NAME}(?:\\s+${NAME})?)`, "gu");

/** The person a request names (« c'est pour Moussa Traoré » → « Moussa Traoré »), or null. */
export function citedPerson(request: string, expertName?: string | null): string | null {
  const own = expertName?.trim().toLowerCase();
  let found: string | null = null;
  for (const m of request.normalize("NFC").matchAll(CITED)) {
    const words = m[1].split(/\s+/).filter((w) => !NOT_A_PERSON.has(w.toLowerCase()));
    if (!words.length || NOT_A_PERSON.has(m[1].split(/\s+/)[0].toLowerCase())) continue;
    if (own && words[0].toLowerCase() === own) continue;
    found = words.join(" ");
  }
  return found;
}

/** A request that already sent the file (« Envoie « … » à … »): no offer to send it again. */
export function isSendRequest(text: string): boolean {
  return /^\s*envoie\s+«/i.test(text);
}
