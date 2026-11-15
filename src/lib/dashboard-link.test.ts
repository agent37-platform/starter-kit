import assert from "node:assert/strict";
import { test } from "node:test";
import { filesAndLink } from "./dashboard-link.ts";

test("le lien déjà connu : les conversations ne sont pas relues", async () => {
  let asked = 0;
  const [files, link] = await filesAndLink("https://a", Promise.resolve("f"), async () => (asked++, "https://b"));
  assert.deepEqual([files, link, asked], ["f", "https://a", 0]);
});

test("sans lien : fichiers et conversations lus en même temps", async () => {
  let release!: (v: string) => void;
  const files = new Promise<string>((r) => (release = r));
  let asked = 0;
  const both = filesAndLink(null, files, async () => (asked++, "https://b"));
  assert.equal(asked, 1, "la lecture des conversations part sans attendre les fichiers");
  release("f");
  assert.deepEqual(await both, ["f", "https://b"]);
});
