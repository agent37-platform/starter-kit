import assert from "node:assert/strict";
import { test } from "node:test";
import { niceMax, runningTotal, stackedBars, ticks } from "./chart.ts";
import { itemsCsv } from "./csv.ts";
import { formatBytes, formatCompact, formatWhole } from "./format.ts";
import type { ChartBreakdown, TimeSeriesPoint } from "./types.ts";

const point = (key: string, partial = false): TimeSeriesPoint => ({ key, label: key, partial, expertsActive: 1 });

test("stackedBars et runningTotal : segments non nuls des séries, dans leur ordre, et total cumulé", () => {
  const chart: ChartBreakdown = {
    unit: "tokens",
    series: [
      { id: "koffi", name: "Koffi" },
      { id: "autres", name: "Autres" },
    ],
    values: [
      [10, 5],
      [0, 0],
      [0, 7],
    ],
  };
  const bars = stackedBars([point("a"), point("b"), point("c", true)], chart);
  assert.deepEqual(bars.map((b) => b.total), [15, 0, 7]);
  assert.deepEqual(bars[2].segments, [{ id: "autres", name: "Autres", value: 7 }]);
  assert.equal(bars[2].partial, true);
  assert.deepEqual(runningTotal(bars), [15, 15, 22]);
});

test("niceMax et ticks : une échelle ronde tirée des données, rien quand il n'y a rien", () => {
  assert.equal(niceMax(0), 0);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(1_340), 2_000);
  assert.equal(niceMax(41_000_000), 50_000_000);
  assert.deepEqual(ticks(2_000), [2_000, 1_500, 1_000, 500, 0]);
});

test("formats : nombres compacts et entiers à la française, tailles en Ko/Mo", () => {
  assert.equal(formatCompact(214_255_962).replace(/\s/g, " "), "214,3 M");
  assert.equal(formatWhole(1340).replace(/\s/g, " "), "1 340");
  assert.equal(formatBytes(512), "512 o");
  assert.equal(formatBytes(5 * 1024 * 1024), "5,0 Mo");
});

test("itemsCsv : les colonnes et en-têtes de l'onglet, taille en octets, guillemets échappés", () => {
  const counted = itemsCsv(
    [{ id: "t", name: 'mcp "apps"', subtitle: "Koffi", iconKind: "tool", share: 60, volume: null, count: 6 }],
    { share: "Consommation", volume: null, count: "Invocations" }
  );
  assert.equal(counted, '﻿Nom,Détail,Consommation (%),Invocations\n"mcp ""apps""",Koffi,60,6\n');
  const consumed = itemsCsv(
    [{ id: "r", name: "Point du soir", iconKind: "cron", share: 100, volume: { value: 1_200, unit: "tokens" }, count: 3 }],
    { share: "Consommation", volume: "Tokens", count: "Exécutions" }
  );
  assert.equal(consumed, "﻿Nom,Détail,Consommation (%),Tokens,Exécutions\nPoint du soir,,100,1200,3\n");
  const files = itemsCsv(
    [{ id: "f", name: "PDF", iconKind: "pdf", share: 100, volume: { value: 5_000, unit: "octets" }, count: 1 }],
    { share: "Fichiers (%)", volume: "Taille", count: "Fichiers" }
  );
  assert.equal(files, "﻿Nom,Détail,Fichiers (%),Taille (octets),Fichiers\nPDF,,100,5000,1\n");
});

test("itemsCsv : un nom qui commencerait une formule est neutralisé (injection CSV), les nombres restent des nombres", () => {
  const csv = itemsCsv(
    [
      { id: "a", name: "=HYPERLINK(\"http://x\")", subtitle: "+1", iconKind: "skill", share: 50, volume: null, count: 1 },
      { id: "b", name: "@SUM(A1)", subtitle: "-2", iconKind: "skill", share: 50, volume: null, count: 1 },
    ],
    { share: "Consommation", volume: null, count: "Invocations" }
  );
  const [, first, second] = csv.trim().split("\n");
  assert.equal(first, `"'=HYPERLINK(""http://x"")",'+1,50,1`);
  assert.equal(second, "'@SUM(A1),'-2,50,1");
});
