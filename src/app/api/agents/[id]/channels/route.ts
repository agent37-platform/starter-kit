import { requireAgentAccess } from "@/lib/auth";
import { handleError, json } from "@/lib/http";
import { listPlatforms } from "@/lib/hermes-messaging";
import { isConnectableChannel, neutralizeHarnessName, sortChannels } from "@/lib/channels";
import type { MessagingPlatform } from "@/lib/channels";

// Slow by nature: this is one exec into the instance, and a sleeping agent is woken first.
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// Every messaging channel this agent supports, with its live state and the credentials it wants.
// Read-only, so any workspace member can see what the agent is connected to.
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireAgentAccess(id, "member");

    return json({ channels: sortChannels(await listPlatforms(id)).filter(isConnectableChannel).map(rebrand) });
  } catch (e) {
    return handleError(e);
  }
}

function rebrand(channel: MessagingPlatform): MessagingPlatform {
  return {
    ...channel,
    description: neutralizeHarnessName(channel.description),
    env_vars: channel.env_vars.map((field) => ({
      ...field,
      description: neutralizeHarnessName(field.description),
      help: neutralizeHarnessName(field.help),
    })),
  };
}
