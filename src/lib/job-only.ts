/** « Expert IA veille commerciale » → « Veille commerciale »: the job alone, « Expert IA » is never repeated (Leslie, 19/11). */
export function jobOnly(v: string | null): string | null {
  if (!v) return v;
  const t = v.replace(/^experte?s?\s+ia\s*(?:[,:–-]\s*)?(?:(?:en|de|du|des)\s+|d['’]\s*)?/i, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : v;
}
