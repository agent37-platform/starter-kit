// Onglet Modèles : tokens par modèle et messages des sessions dont il est le modèle principal.

import type { SessionUsageRow } from "../../yele-mcp/types.ts";
import { modelLabel } from "../names.ts";
import type { Dimension } from "../types.ts";
import { consumptionDimension } from "./consumption.ts";

export function modelsTab(rows: SessionUsageRow[], labels: Record<string, string> | null): Dimension {
  return consumptionDimension(
    rows,
    (r) => r.model,
    (model, t, share) => ({
      id: `model_${model}`,
      name: modelLabel(model, labels),
      iconKind: "model",
      filter: { dimension: "models", value: model },
      share,
      volume: { value: t.tokens, unit: "tokens" },
      count: t.messages,
    })
  );
}
