import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INBOX_LIMIT_CODE,
  INBOX_LIMIT_TEXT,
  MAIL_DOWN_TEXT,
  inboxRefusal,
  moreInboxesHref,
  bareAddress,
  inboxOf,
  isSent,
  mailPath,
  parseCreateMailInboxInput,
  parseMailTarget,
  mailTargetQuery,
  parseMailDraft,
  parseMailReply,
  parseRecipients,
  sanitizeInboxDisplayName,
  sandboxedMail,
  userInitials,
  type MailInbox,
} from "./mail.ts";

test("a back-office path is only built from plain segments", () => {
  assert.equal(mailPath("djeneba"), "/app/mail/inboxes/djeneba/messages");
  assert.equal(mailPath("djeneba", "PDAxQG0-"), "/app/mail/inboxes/djeneba/messages/PDAxQG0-");
  assert.equal(mailPath("djeneba", "PDAxQG0-", "YTE"), "/app/mail/inboxes/djeneba/messages/PDAxQG0-/attachments/YTE");
  for (const [expert, message, attachment] of [
    ["../rights", undefined, undefined],
    ["Djeneba", undefined, undefined],
    ["djeneba", "<m1@x>", undefined],
    ["djeneba", "a/../../rights", undefined],
    ["djeneba", "PDAx", "a?x=1"],
    ["djeneba", "", undefined],
  ] as const) {
    assert.equal(mailPath(expert, message, attachment), null);
  }
});

test("recipients typed in one field are split, lowercased and deduplicated", () => {
  assert.deepEqual(parseRecipients(" Awa@Acme.ci, koffi@acme.ci;awa@acme.ci "), ["awa@acme.ci", "koffi@acme.ci"]);
  assert.equal(parseRecipients(""), null);
  assert.equal(parseRecipients("awa@acme"), null);
  assert.equal(parseRecipients("Awa <awa@acme.ci>"), null);
  assert.equal(parseRecipients(Array.from({ length: 21 }, (_, i) => `a${i}@acme.ci`).join(",")), null);
});

test("the sender's address is read out of its display form", () => {
  assert.equal(bareAddress("Koffi Yao <koffi@exemple.ci>"), "koffi@exemple.ci");
  assert.equal(bareAddress("koffi@exemple.ci"), "koffi@exemple.ci");
});

test("a message is sent or received by its label", () => {
  assert.equal(isSent(["sent", "m-3"]), true);
  assert.equal(isSent(["received"]), false);
});

test("a received e-mail is wrapped in a document that fetches nothing but images and opens links elsewhere", () => {
  const doc = sandboxedMail("<script>alert(1)</script><img src=x onerror=alert(2)>");
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:"/);
  assert.match(doc, /<base target="_blank">/);
  // The markup is passed through untouched: it is the iframe's empty sandbox that keeps it inert.
  assert.match(doc, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(doc, /script-src|connect-src|form-action/);
});

test("create-inbox payload: expert key and instance required, display name sanitized", () => {
  assert.deepEqual(parseCreateMailInboxInput({ expert: "koffi", agentId: "inst-1", displayName: "Amina <Koffi>!" }), {
    expert: "koffi",
    agentId: "inst-1",
    displayName: "Amina Koffi",
  });
  assert.deepEqual(parseCreateMailInboxInput({ expert: "koffi", agentId: "inst-1", displayName: "   " }), { expert: "koffi", agentId: "inst-1" });
  assert.equal(parseCreateMailInboxInput({ expert: "koffi" }), null);
  assert.equal(parseCreateMailInboxInput({ expert: "koffi", agentId: "../bad" }), null);
  assert.equal(parseCreateMailInboxInput({ expert: "../evil", agentId: "inst-1" }), null);
  assert.equal(parseCreateMailInboxInput({ expert: "Koffi", agentId: "inst-1" }), null);
  assert.equal(parseCreateMailInboxInput(null), null);
  assert.equal(parseCreateMailInboxInput([]), null);
  assert.equal(sanitizeInboxDisplayName("a".repeat(80))?.length, 60);
});

test("inbox target: the instance or a member by e-mail, never both, never malformed", () => {
  assert.deepEqual(parseCreateMailInboxInput({ expert: "koffi", member: " Awa@Acme.CI " }), { expert: "koffi", member: "awa@acme.ci" });
  assert.equal(parseCreateMailInboxInput({ expert: "koffi", agentId: "inst-1", member: "awa@acme.ci" }), null);
  assert.equal(parseCreateMailInboxInput({ expert: "koffi", member: "Awa <awa@acme.ci>" }), null);
  assert.equal(mailTargetQuery({ member: "awa+x@acme.ci" }), "member=awa%2Bx%40acme.ci");
  assert.equal(parseMailTarget(undefined, undefined), null);
});

test("an instance's inbox for an expert, among those listed for the member", () => {
  const inbox = (expert: string, agentId?: string): MailInbox => ({ expert, agentId, address: `${expert}@x.ci`, sendEnabled: true, canSend: true, externalAllowed: false });
  const mine = inbox("koffi", "inst-1");
  const older = inbox("awa");
  const other = inbox("djeneba", "inst-2");
  assert.equal(inboxOf([older, mine, other], "koffi", "inst-1"), mine);
  assert.equal(inboxOf([older, mine, other], "awa", "inst-1"), older);
  assert.equal(inboxOf([older, mine, other], "djeneba", "inst-1"), null);
});

test("userInitials builds lowercase ASCII initials from full names or email fallback", () => {
  assert.equal(userInitials("Christy B."), "cb");
  assert.equal(userInitials("Paul Kouassi"), "pk");
  assert.equal(userInitials("Djénéba Traoré"), "dt");
  assert.equal(userInitials("christy@mstudio.ci"), "ch");
  assert.equal(userInitials("   "), "u");
});

test("a draft is reduced to its fields and checked: recipients, subject without line breaks, attachments", () => {
  const draft = parseMailDraft({
    to: ["Awa@Acme.ci", "awa@acme.ci"],
    subject: "Devis\r\nBcc: tous@acme.ci",
    text: "Bonjour",
    bcc: ["cache@acme.ci"],
    headers: { "X-Spoof": "1" },
    from: "patron@acme.ci",
    attachments: [{ filename: "devis\n.pdf", contentType: "application/pdf", content: "JVBERi0=", extra: 1 }],
  });
  assert.deepEqual(draft, {
    to: ["awa@acme.ci"],
    subject: "Devis Bcc: tous@acme.ci",
    text: "Bonjour",
    attachments: [{ filename: "devis .pdf", contentType: "application/pdf", content: "JVBERi0=" }],
  });
  assert.equal(parseMailDraft({ to: [], subject: "s", text: "t" }), null);
  assert.equal(parseMailDraft({ to: ["awa@acme.ci"], subject: 1, text: "t" }), null);
  assert.equal(parseMailDraft({ to: ["awa@acme.ci"], subject: "s", text: "t", attachments: [{ filename: "a", contentType: "text/html; x", content: "QQ==" }] }), null);
  assert.equal(parseMailDraft({ to: ["awa@acme.ci"], subject: "s", text: "t", attachments: [{ filename: "a", contentType: "text/plain", content: "<script>" }] }), null);
  assert.deepEqual(parseMailReply({ text: "Merci", to: ["autre@acme.ci"] }), { text: "Merci" });
  assert.equal(parseMailReply({}), null);
});

test("an address refused because none is left says so; an outage says it is one", () => {
  assert.deepEqual(inboxRefusal(403, "inbox_limit_reached", "Le service d’e-mail ne répond pas."), { status: 409, code: INBOX_LIMIT_CODE, message: INBOX_LIMIT_TEXT });
  assert.equal(inboxRefusal(502, "unavailable", "x").message, MAIL_DOWN_TEXT);
  assert.equal(inboxRefusal(503, null, "x").code, "unavailable");
  assert.deepEqual(inboxRefusal(403, "forbidden", "Seul un administrateur…"), { status: 403, code: "forbidden", message: "Seul un administrateur…" });
  const href = moreInboxesHref("Unifood", "Djénéba");
  assert.ok(href.startsWith("mailto:contact@yelema.ai?subject="));
  assert.ok(decodeURIComponent(href).includes("pour Djénéba"));
});
