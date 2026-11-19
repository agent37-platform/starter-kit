import { backoffice } from "@/lib/backoffice";
import { ApiError, readJson } from "@/lib/http";
import { answerCheckRefusal, parseCheckChoice } from "@/lib/answer-check";
import { noStore, settingsError, settingsToken } from "../_shared";

// `GET|PUT|DELETE /api/llm/judge` — the answer check of the signed-in user's own instance: which
// provider and model re-read a reply before it leaves. The back office checks the pick against the
// instance's accounts and installs it; the app passes it on.
export async function GET() {
  try {
    return noStore(await backoffice.answerCheck(await settingsToken()));
  } catch (e) {
    return settingsError(e, answerCheckRefusal);
  }
}

export async function PUT(request: Request) {
  try {
    const choice = parseCheckChoice(await readJson(request));
    if (!choice) throw new ApiError(400, "bad_request", "Cette demande n’a pas pu être traitée.");
    return noStore(await backoffice.setAnswerCheck(await settingsToken(), choice));
  } catch (e) {
    return settingsError(e, answerCheckRefusal);
  }
}

export async function DELETE() {
  try {
    return noStore(await backoffice.resetAnswerCheck(await settingsToken()));
  } catch (e) {
    return settingsError(e, answerCheckRefusal);
  }
}
