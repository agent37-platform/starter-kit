import { chatSessions } from "@/lib/chat-sessions";
import { handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json({ sessions: await chatSessions(id, new URL(request.url).searchParams.get("profile")) });
  } catch (e) {
    return handleError(e);
  }
}
