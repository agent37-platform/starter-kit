import assert from "node:assert/strict";
import { test } from "node:test";
import { STRIP_CREDENTIALS_BOOTSTRAP } from "./site-url.ts";

// As Firefox shows it: `location` without the credentials, `document.URL` with them.
function run(href: string): string | null {
  const shown = new URL(href);
  shown.username = shown.password = "";
  let replaced: string | null = null;
  const location = { href: shown.href, username: "", password: "", replace: (to: string) => (replaced = to) };
  new Function("location", "document", STRIP_CREDENTIALS_BOOTSTRAP)(location, { URL: href });
  return replaced;
}

test("a page opened with credentials reloads without them, path and query kept", () => {
  assert.equal(run("https://u:p@mstudio.app.yelema.ai/login?next=%2F#x"), "https://mstudio.app.yelema.ai/login?next=%2F#x");
  assert.equal(run("https://u@mstudio.app.yelema.ai/"), "https://mstudio.app.yelema.ai/");
});

test("a normal address is left alone", () => {
  assert.equal(run("https://mstudio.app.yelema.ai/experts"), null);
});
