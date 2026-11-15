import "server-only";
import { agent37 } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import type { DriveTree } from "@/lib/drive-paths";
import { treeLoader } from "@/lib/drive-tree";
import { memo } from "@/lib/memo";

// Several tabs and screens of one member ask together: one walk per instance every few seconds.
const trees = memo<DriveTree>({ ttlMs: 10_000, maxEntries: 2000, maxFlightMs: 90_000 });
const load = treeLoader();

/** The drive of an instance the caller may open (GET /api/agents/[id]/files/tree). */
export async function instanceDriveTree(id: string): Promise<DriveTree> {
  await requireAgentAccess(id);
  return trees.get(id, () =>
    load({
      tree: (root, depth) => agent37.fileTree(id, root, depth),
      list: async (path) => (await agent37.listFiles(id, path)).entries ?? [],
      makeDir: (path) => agent37.makeDir(id, path),
    })
  );
}
