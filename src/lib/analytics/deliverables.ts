import { docKind } from "../drive-links.ts";
import type { RawFileInfo } from "../yele-mcp/types.ts";
import type { DeliverableSummary } from "./types.ts";

export function deliverableSummaries(files: RawFileInfo[]): DeliverableSummary[] {
  return files.map((f) => ({
    size: f.size ?? null,
    modified: f.modified ?? null,
    kind: docKind(f.name),
  }));
}
