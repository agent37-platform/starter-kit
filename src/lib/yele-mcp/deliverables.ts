// Lecteur des fichiers du dossier Livrables, à toute profondeur, sans les fichiers filtrés par isDriveClutter.

import { isDriveClutter } from "../drive-order.ts";
import { hermesReader, type InstanceReader } from "./hermes-layout.ts";
import type { RawFileInfo } from "./types.ts";

const SCRIPT = String.raw`
root = home_path(L["dirs"]["deliverables"])
files = []
for d, dirs, names in _os.walk(root):
    dirs[:] = [x for x in dirs if not x.startswith(".")]
    for n in names:
        if n.startswith("."):
            continue
        p = _os.path.join(d, n)
        try:
            st = _os.stat(p)
        except OSError:
            continue
        files.append([_os.path.relpath(p, root), st.st_size, int(st.st_mtime * 1000)])
emit({"exists": _os.path.isdir(root), "files": files})
`;

export const deliverablesReader = (): InstanceReader => hermesReader(SCRIPT);

/** Valide le résultat du lecteur ; livrables du plus récent au plus ancien. */
export function parseDeliverables(json: string): RawFileInfo[] {
  const raw = JSON.parse(json) as { files?: unknown[][] };
  if (!Array.isArray(raw.files)) throw new Error("sortie inattendue");
  return raw.files
    .filter(Array.isArray)
    .map((f) => ({ path: String(f[0]), size: Number(f[1]) || 0, modified: Number(f[2]) || null }))
    .filter(({ path }) => {
      const parts = path.split("/");
      const name = parts.pop()!;
      return !parts.some((dir) => isDriveClutter({ name: dir, type: "directory" })) && !isDriveClutter({ name, type: "file" });
    })
    .map(({ path, size, modified }) => ({ name: path.split("/").pop()!, path, size, modified }))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
}
