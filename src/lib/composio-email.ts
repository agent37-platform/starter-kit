// An e-mail an expert sends through the client's Gmail or Outlook (Composio) leaves formatted: its plain body is
// rendered as HTML (src/lib/mail-format.ts) and `is_html` set, in the request the proxy forwards. A body the expert
// already wrote in HTML, or one marked `is_html`, is left as it is. Pure, so `node --test` runs it as it is.
// Argument names: docs.composio.dev/toolkits/gmail (20261116_00) and /outlook (20261116_01).
import { mailHtml } from "./mail-format.ts";

/** The argument holding the body, per tool that takes `is_html`. */
const BODY_OF: Record<string, readonly string[]> = {
  GMAIL_SEND_EMAIL: ["body"],
  GMAIL_CREATE_EMAIL_DRAFT: ["body", "message_body"],
  GMAIL_REPLY_TO_THREAD: ["message_body"],
  OUTLOOK_SEND_EMAIL: ["body"],
  OUTLOOK_CREATE_DRAFT: ["body"],
  OUTLOOK_REPLY_EMAIL: ["comment"],
};
const MULTI_EXECUTE = "COMPOSIO_MULTI_EXECUTE_TOOL";
const LOOKS_HTML = /<(p|div|br|table|ul|ol|li|h[1-6]|strong|b|a|span|html|body)\b[^>]*>/i;

/** Formats one tool's arguments in place; true when it changed them. */
function formatArgs(slug: unknown, args: unknown): boolean {
  const keys = typeof slug === "string" ? BODY_OF[slug.toUpperCase()] : undefined;
  if (!keys || !args || typeof args !== "object") return false;
  const a = args as Record<string, unknown>;
  if (a.is_html === true) return false;
  const key = keys.find((k) => typeof a[k] === "string" && (a[k] as string).trim() !== "");
  if (!key || LOOKS_HTML.test(a[key] as string)) return false;
  a[key] = mailHtml(a[key] as string);
  a.is_html = true;
  return true;
}

/** The request body with every e-mail formatted, or null when nothing in it is an e-mail to format (or it does not parse). */
export function formatEmailCalls(bodyText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  let changed = false;
  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    const m = message as { method?: unknown; params?: { name?: unknown; arguments?: Record<string, unknown> } } | null;
    if (m?.method !== "tools/call" || !m.params) continue;
    const { name, arguments: args } = m.params;
    if (name === MULTI_EXECUTE && Array.isArray(args?.tools)) {
      for (const t of args.tools) changed = formatArgs((t as { tool_slug?: unknown })?.tool_slug, (t as { arguments?: unknown })?.arguments) || changed;
    } else if (args) {
      changed = formatArgs(args.tool_slug ?? name, args.arguments ?? args) || changed;
    }
  }
  return changed ? JSON.stringify(parsed) : null;
}
