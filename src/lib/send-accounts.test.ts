import assert from "node:assert/strict";
import { test } from "node:test";
import { isDialogSend, recipientList, sendAccounts, sendFilesText, sendRoutineText } from "./send-accounts.ts";
import type { IntegrationConnection } from "./types";

const gmail: IntegrationConnection = { id: "c1", status: "ACTIVE", toolkitSlug: "gmail", email: "leslie@exemple.ci" };
const base = { connections: [], inbox: null, unipile: null, profileId: "silverplate__awa", expertName: "Awa" };

test("rien de branché : aucun compte proposé", () => {
  assert.deepEqual(sendAccounts(base), []);
});

test("Gmail actif proposé, compte en échec ou désactivé écarté", () => {
  const list = sendAccounts({ ...base, connections: [gmail, { id: "c2", status: "FAILED", toolkitSlug: "outlook" }, { id: "c3", status: "ACTIVE", toolkitSlug: "gmail", isDisabled: true }] });
  assert.deepEqual(list.map((a) => [a.title, a.detail]), [["Votre Gmail", "leslie@exemple.ci"]]);
  assert.match(list[0].how, /outil Gmail connecté \(compte leslie@exemple\.ci\)/);
});

test("adresse de l'Experte seulement si elle peut envoyer pour ce membre", () => {
  const inbox = { address: "awa@yelema.ai", sendEnabled: true, canSend: false };
  assert.equal(sendAccounts({ ...base, inbox }).length, 0);
  assert.equal(sendAccounts({ ...base, inbox: { ...inbox, canSend: true } })[0].title, "L’adresse d’Awa");
});

test("Unipile : seulement si l'Experte y a accès, comptes cassés écartés, e-mail d'abord", () => {
  const unipile = {
    connected: true,
    experts: ["silverplate__awa"],
    accounts: [
      { id: "u1", type: "LINKEDIN", name: "Leslie O.", status: "OK" },
      { id: "u2", type: "WHATSAPP", name: "+225 07 00 00 00 00", status: "CREDENTIALS" },
      { id: "u3", type: "WHATSAPP", name: "+225 01 00 00 00 00", status: null },
    ],
  };
  assert.deepEqual(sendAccounts({ ...base, connections: [gmail], unipile }).map((a) => a.channel), ["mail", "whatsapp", "linkedin"]);
  assert.equal(sendAccounts({ ...base, unipile: { ...unipile, experts: ["silverplate__kouassi"] } }).length, 0);
});

test("moi-même devient la vraie adresse, et disparaît hors e-mail", () => {
  assert.deepEqual(recipientList(true, "leslie@exemple.ci", "Moussa, a@b.ci", "mail"), ["leslie@exemple.ci", "Moussa", "a@b.ci"]);
  assert.deepEqual(recipientList(true, "leslie@exemple.ci", "+225 07", "whatsapp"), ["+225 07"]);
});

test("consigne : compte, chemins exacts et preuve demandée", () => {
  const [account] = sendAccounts({ ...base, connections: [gmail] });
  const text = sendFilesText([{ name: "a.pdf", path: "~/Livrables/Awa/a.pdf" }, { name: "b.xlsx", path: "~/Livrables/Awa/b.xlsx" }], ["leslie@exemple.ci"], account);
  assert.match(text, /^Envoie ces 2 livrables à leslie@exemple\.ci par e-mail, avec l’outil Gmail connecté/);
  assert.match(text, /\n- ~\/Livrables\/Awa\/a\.pdf\n- ~\/Livrables\/Awa\/b\.xlsx\n/);
  assert.match(text, /dis-moi à qui et à quelle heure/);
  assert.match(sendRoutineText("each", ["a@b.ci", "c@d.ci"], account, true), /à a@b\.ci et c@d\.ci par e-mail, avec l’outil Gmail/);
});

test("la consigne de la fenêtre se reconnaît, pas une demande tapée", () => {
  const [account] = sendAccounts({ ...base, connections: [gmail] });
  assert.equal(isDialogSend(sendFilesText([{ name: "a.pdf", path: "~/Livrables/a.pdf" }], ["x@y.ci"], account)), true);
  assert.equal(isDialogSend("Envoie le devis à Moussa"), false);
});

test("the copies go on the first line, on e-mail only, and a file line reads as its name", async () => {
  const { sendFilesText: text, sentFileLine } = await import("./send-accounts.ts");
  const gmail = { id: "composio:1", channel: "mail" as const, title: "Gmail", detail: null, how: "avec l’outil Gmail connecté" };
  const files = [{ name: "R.pdf", path: "~/Livrables/Djeneba/R.pdf" }];
  const first = text(files, ["kirane@mstudio.vc"], gmail, { cc: ["leslie@mstudio.vc"], bcc: ["a@b.ci", "c@d.ci"] }).split("\n")[0];
  assert.equal(first, "Envoie ce livrable à kirane@mstudio.vc, en copie (Cc) leslie@mstudio.vc, en copie cachée (Cci) a@b.ci et c@d.ci, par e-mail, avec l’outil Gmail connecté, en pièces jointes :");
  const wa = { ...gmail, channel: "whatsapp" as const, how: "avec Unipile" };
  assert.doesNotMatch(text(files, ["Moussa"], wa, { cc: ["x@y.z"] }), /copie/);
  assert.deepEqual(sentFileLine("- ~/Livrables/Djeneba/Silverplate/R v13.pdf"), { path: "~/Livrables/Djeneba/Silverplate/R v13.pdf", name: "R v13.pdf" });
  assert.equal(sentFileLine("Utilise ce compte et aucun autre."), null);
});
