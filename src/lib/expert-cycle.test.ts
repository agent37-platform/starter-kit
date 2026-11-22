import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueCycle, catalogueJob, expertRank } from "./expert-cycle.ts";

const BO = (label: string) => ({ key: label.toLowerCase(), label });
const ex = (profileId: string, label: string | null) => ({ profileId, catalogueKey: null, cycle: label ? BO(label) : null });

test("the catalogue's cycle wins over the back office's label, Djénéba has none", () => {
  assert.deepEqual(catalogueCycle({ profileId: "unifood__ibrahim" }, BO("Légal")), { key: "investissement", label: "Investissement" });
  assert.deepEqual(catalogueCycle({ profileId: "unifood__awa" }, BO("Ventes & Relation client")), { key: "service-client", label: "Service client" });
  assert.deepEqual(catalogueCycle({ profileId: "unifood__alioune" }, null), { key: "investissement", label: "Investissement" });
  assert.equal(catalogueCycle({ profileId: "unifood__djeneba" }, BO("Direction")), null);
});

test("Djénéba first, then the catalogue's cycles and places", () => {
  const ids = ["alioune", "koffi", "djeneba", "fatima", "awa", "kouassi", "salif", "adjoua", "fatou", "mamadou", "ibrahim"];
  const sorted = ids.map((n) => ex(`unifood__${n}`, null)).sort((a, b) => expertRank(a) - expertRank(b));
  assert.deepEqual(
    sorted.map((e) => e.profileId.split("__")[1]),
    ["djeneba", "kouassi", "fatima", "koffi", "awa", "fatou", "adjoua", "mamadou", "salif", "alioune", "ibrahim"]
  );
});

test("the catalogue names the cycle, whatever the back office sends", () => {
  assert.deepEqual(catalogueCycle({ catalogueKey: "salif", profileId: "unifood__salif" }, { key: "ops", label: "Opérations & Données" }), {
    key: "operations",
    label: "Opérations",
  });
  assert.equal(catalogueCycle({ catalogueKey: "fatou", profileId: "unifood__fatou" }, null)?.label, "Ressources Humaines");
});

test("an Expert's job comes from the catalogue, short", () => {
  assert.equal(catalogueJob({ catalogueKey: "mamadou", profileId: "unifood__mamadou" }, "Comptabilité & Finance générale"), "Comptable général");
  assert.equal(catalogueJob({ catalogueKey: null, profileId: "unifood__djeneba" }, null), "Chief of Staff & Direction");
  assert.equal(catalogueJob({ catalogueKey: "nadia", profileId: "unifood__nadia" }, "Données & Analyse"), "Données & Analyse");
});

test("an Expert out of the catalogue goes under the cycle its back-office label names", () => {
  assert.deepEqual(catalogueCycle({ profileId: "unifood__nadia" }, BO("Opérations & Données")), { key: "operations", label: "Opérations" });
  assert.deepEqual(catalogueCycle({ profileId: "unifood__zoe" }, BO("Légal")), BO("Légal"));
});

test("the cycles follow the order of the offer", () => {
  const rank = (k: string) => expertRank({ profileId: `unifood__${k}`, catalogueKey: k, cycle: null });
  const order = ["kouassi", "fatima", "awa", "fatou", "mamadou", "salif", "alioune"].map(rank);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("Ali, who replaced Yacouba, is in Opérations; Alioune stays in Investissement", () => {
  assert.equal(catalogueCycle({ catalogueKey: "ali", profileId: "unifood__ali" }, null)?.label, "Opérations");
  assert.equal(catalogueCycle({ catalogueKey: "alioune", profileId: "unifood__alioune" }, null)?.label, "Investissement");
  assert.equal(catalogueJob({ catalogueKey: "ali", profileId: "unifood__ali" }, null), "Achats et import");
});
