import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEmailCalls } from "./composio-email.ts";
import { mailHtml, mailText } from "./mail-format.ts";

const call = (args: unknown, name = "COMPOSIO_MULTI_EXECUTE_TOOL") => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const BODY = "Bonjour Kirane,\n\nVoici le recueil pour la Galerie Cécile Fakhoury,\npour ta validation avant tout envoi.\n\nEn option :\n- **Salif** : transports\n- Mamadou : devis\n\nLe recueil : https://docs.google.com/presentation/d/abc/edit\n\nDjénéba";

test("a Gmail or Outlook e-mail leaves as HTML, its lines joined, bullets, bold and links on a label", () => {
  const out = JSON.parse(formatEmailCalls(call({ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "k@x.ci", cc: ["l@x.ci"], body: BODY } }, { tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "x" } }] }))!);
  const a = out.params.arguments.tools[0].arguments;
  assert.equal(a.is_html, true);
  assert.deepEqual(a.cc, ["l@x.ci"]);
  assert.match(a.body, /Fakhoury, pour ta validation/);
  assert.match(a.body, /<ul[^>]*><li[^>]*><strong[^>]*>Salif<\/strong> : transports/);
  assert.match(a.body, /<a href="https:\/\/docs\.google\.com\/presentation\/d\/abc\/edit"[^>]*>Ouvrir la présentation<\/a>/);
  assert.deepEqual(out.params.arguments.tools[1].arguments, { query: "x" });
});

test("a reply, an Outlook reply and a direct call are formatted on their own body field", () => {
  for (const [slug, key] of [["GMAIL_REPLY_TO_THREAD", "message_body"], ["OUTLOOK_REPLY_EMAIL", "comment"], ["OUTLOOK_SEND_EMAIL", "body"]] as const) {
    const out = JSON.parse(formatEmailCalls(call({ tools: [{ tool_slug: slug, arguments: { [key]: "Bonjour,\n\nMerci." } }] }))!);
    assert.equal(out.params.arguments.tools[0].arguments.is_html, true, slug);
  }
  const direct = JSON.parse(formatEmailCalls(call({ body: "Bonjour" }, "GMAIL_SEND_EMAIL"))!);
  assert.equal(direct.params.arguments.is_html, true);
});

test("HTML already written, is_html set, other tools and unreadable bodies are left alone", () => {
  assert.equal(formatEmailCalls(call({ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "<p>Bonjour</p>" } }] })), null);
  assert.equal(formatEmailCalls(call({ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "x", is_html: true } }] })), null);
  assert.equal(formatEmailCalls(call({ tools: [{ tool_slug: "SLACK_CHAT_POST_MESSAGE", arguments: { text: "x" } }] })), null);
  assert.equal(formatEmailCalls("{not json"), null);
  assert.equal(formatEmailCalls(JSON.stringify({ method: "tools/list" })), null);
});

test("the HTML escapes what the expert wrote, and the text version keeps the paragraphs", () => {
  assert.doesNotMatch(mailHtml("Bonjour <script>alert(1)</script>"), /<script>/);
  assert.match(mailHtml("## Points\n\nTexte."), /<h3[^>]*>Points<\/h3>/);
  assert.equal(mailText("Ligne coupée par l'expert au milieu de la phrase sans fin\nqui continue ici.\n\n- **A** : un"), "Ligne coupée par l'expert au milieu de la phrase sans fin qui continue ici.\n\n- A : un");
});
