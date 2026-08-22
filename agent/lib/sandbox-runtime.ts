import type { SessionContext } from "eve/context";
import { hydrateWorkspaceFromMongo } from "./sandbox-checkpoints";
import { requireTenantScope } from "./tenant";

export async function ensureSandboxHydrated(ctx: SessionContext): Promise<void> {
  const sandbox = await ctx.getSandbox();
  await hydrateWorkspaceFromMongo(sandbox, requireTenantScope(ctx), ctx.session.id);
}
