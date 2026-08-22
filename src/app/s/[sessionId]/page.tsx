import { EveHub } from "@/components/eve-hub";
import { SignIn } from "@/components/sign-in";
import { currentHubIdentity } from "@/lib/hub-server";

export default async function SessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  const identity = await currentHubIdentity();
  if (!identity) return <SignIn />;
  return <EveHub identity={identity} initialSessionId={sessionId} />;
}
