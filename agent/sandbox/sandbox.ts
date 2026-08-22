import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { hydrateWorkspaceFromMongo } from "../lib/sandbox-checkpoints";
import { requireTenantScope } from "../lib/tenant";

export default defineSandbox({
  backend: docker({
    image: process.env.EVE_SANDBOX_IMAGE ?? "ghcr.io/vercel/eve:latest",
    networkPolicy: "deny-all",
    pullPolicy: "if-not-present",
  }),
  description:
    "A per-conversation, network-isolated business workspace. MongoDB checkpoints restore it if the container is replaced.",
  async onSession(input) {
    const { ctx } = input;
    const sandbox = await input.use();
    await hydrateWorkspaceFromMongo(sandbox, requireTenantScope(ctx), ctx.session.id);
    await sandbox.writeTextFile({
      path: ".eve-hub/session.json",
      content: `${JSON.stringify(
        {
          sandboxId: sandbox.id,
          sessionId: ctx.session.id,
          workspaceId: requireTenantScope(ctx).workspaceId,
        },
        null,
        2,
      )}\n`,
    });
  },
});
