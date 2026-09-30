import "server-only";
import { ApiError } from "@/lib/http";
import type { TelegramBotCheck, TelegramOwner } from "@/lib/channels";

// Telegram's Bot API, called with the token the user just pasted. Two jobs, both before anything is
// written into the agent:
//
//  1. `getMe` proves the token works and gives us the bot's @username, so a typo is caught here
//     rather than by the agent's messaging gateway (which refuses to start on a bad token).
//  2. `getUpdates` reads the first message sent to the bot, which is how we learn WHO owns it.
//     That user id becomes the whole allowlist, so nobody else who finds the bot can reach the agent.
//
// The token never reaches the browser after this: it is posted once, checked here, and written
// straight into the instance.
const API = "https://api.telegram.org";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function assertBotTokenShape(token: string): string {
  const trimmed = token.trim();
  if (!BOT_TOKEN_PATTERN.test(trimmed)) {
    throw new ApiError(
      400,
      "invalid_request",
      "That does not look like a bot token. BotFather sends a numeric id, a colon, then a long secret."
    );
  }
  return trimmed;
}

async function callBot<T>(token: string, method: string, query = ""): Promise<TelegramResponse<T>> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return (await res.json()) as TelegramResponse<T>;
  } catch {
    throw new ApiError(502, "telegram_unreachable", "Telegram did not answer. Try again.");
  }
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}

// Throws a 400 the panel can show verbatim when Telegram rejects the token.
export async function checkBotToken(token: string): Promise<TelegramBotCheck> {
  const response = await callBot<TelegramUser>(token, "getMe");
  if (!response.ok || !response.result?.username) {
    throw new ApiError(400, "invalid_bot_token", "Telegram rejected that token. Copy it again from @BotFather.");
  }
  return { username: response.result.username, name: response.result.first_name ?? null };
}

interface TelegramUpdate {
  message?: { from?: TelegramUser };
  edited_message?: { from?: TelegramUser };
  channel_post?: { from?: TelegramUser };
}

export interface TelegramOwnerLookup {
  owner: TelegramOwner | null;
  // True once the bot is on a webhook (Telegram then refuses long polling), which is what a bot that
  // is ALREADY wired to an agent looks like. The panel stops waiting and offers to connect anyway.
  unavailable: boolean;
}

// One non-blocking read of the bot's inbox. The panel calls this on a timer while it asks the user to
// message their bot, so a single miss is just "nobody has written yet".
export async function findBotOwner(token: string): Promise<TelegramOwnerLookup> {
  const response = await callBot<TelegramUpdate[]>(token, "getUpdates", "?limit=10&timeout=0");
  if (!response.ok) return { owner: null, unavailable: response.error_code === 409 };

  const from = (response.result ?? [])
    .map((update) => update.message?.from ?? update.edited_message?.from ?? update.channel_post?.from)
    .find((user) => user && !user.is_bot);
  if (!from) return { owner: null, unavailable: false };
  return { owner: { user_id: String(from.id), name: from.first_name ?? from.username ?? null }, unavailable: false };
}
