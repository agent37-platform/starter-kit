// The versions of one document in a folder (Leslie, 02/11): an Expert saves each revision as a new
// file, « devis_v17.pdf » then « devis_v18.pdf », and a folder of quotes ends up with eighteen. Only
// the latest shows; the others fold under « Versions précédentes ». Nothing is deleted here: the
// Expert proposes it once a version is approved, and waits for the member's yes.
// Pure and without imports, so `node --test` runs it as it is.

const VERSION = /^(.*?)[-_ .]v(\d{1,4})(\.[^.]+)?$/i;

/** « devis-simple_v18.pdf » → { key: "devis-simple.pdf", n: 18 }; null without a version number. */
export function versionOf(name: string): { key: string; n: number } | null {
  const m = VERSION.exec(name.trim());
  if (!m || !m[1]) return null;
  return { key: `${m[1].toLowerCase()}${(m[3] ?? "").toLowerCase()}`, n: Number(m[2]) };
}

/**
 * The entries with each document's older versions set apart. A document counts as versioned when two
 * files or more share its name but for the number; the highest number stays (compared as numbers: v10
 * beats v9), the others go to `older`, by document, newest first. Folders and unversioned files stay as they are,
 * in their order.
 */
export function splitVersions<T extends { name: string; type?: string }>(entries: readonly T[]): { current: T[]; older: T[] } {
  const best = new Map<string, { entry: T; n: number }>();
  const count = new Map<string, number>();
  for (const e of entries) {
    if (e.type === "directory") continue;
    const v = versionOf(e.name);
    if (!v) continue;
    count.set(v.key, (count.get(v.key) ?? 0) + 1);
    const held = best.get(v.key);
    if (!held || v.n > held.n) best.set(v.key, { entry: e, n: v.n });
  }
  const current: T[] = [];
  const older: { entry: T; n: number; key: string }[] = [];
  for (const e of entries) {
    const v = e.type === "directory" ? null : versionOf(e.name);
    if (!v || (count.get(v.key) ?? 0) < 2 || best.get(v.key)?.entry === e) current.push(e);
    else older.push({ entry: e, n: v.n, key: v.key });
  }
  // One document after the other, each newest first.
  older.sort((a, b) => a.key.localeCompare(b.key, "fr") || b.n - a.n);
  return { current, older: older.map((o) => o.entry) };
}

// « Archiver » an old version (Leslie, 16/11: archiver n'est pas supprimer): the file moves into an
// « Archivées » folder beside it. It stays there, opened and downloaded as any file, and comes back with
// « Remettre ». What is archived never shows as a deliverable, a new one or a version.
export const ARCHIVE_FOLDER = "Archivées";

/** True for the « Archivées » folder itself and everything in it, at any depth. */
export function isArchived(path: string): boolean {
  return path.split("/").includes(ARCHIVE_FOLDER);
}

/** The versions of `name`'s document among `entries` that are newer than it (« Garder » archives them). */
export function newerVersions<T extends { name: string; type?: string }>(name: string, entries: readonly T[]): T[] {
  const v = versionOf(name);
  if (!v) return [];
  return entries.filter((e) => {
    if (e.type === "directory") return false;
    const o = versionOf(e.name);
    return !!o && o.key === v.key && o.n > v.n;
  });
}
