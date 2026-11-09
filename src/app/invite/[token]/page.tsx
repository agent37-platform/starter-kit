import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { AcceptInvite } from "@/components/AcceptInvite";
import { branding } from "@/config/branding";

type Ctx = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: Ctx) {
  const { token } = await params;
  const { user } = await getSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  // getInvitation is gated by the token (a secret), not by membership, so a not-yet-member can
  // read what they were invited to. Runs through the privileged data layer.
  const inv = await getStore().getInvitation(token);

  if (!inv) return <Message text="This invitation is invalid or no longer exists." />;
  if (inv.expired) return <Message text="This invitation has expired." />;

  return <AcceptInvite token={token} workspaceName={inv.workspace_name} role={inv.role} />;
}

function Message({ text }: { text: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{branding.appName}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </main>
  );
}
