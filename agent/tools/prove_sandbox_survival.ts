import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { replaceOpenShellSandbox } from "../lib/openshell";
import { requireTenantScope } from "../lib/tenant";

export default defineTool({
  approval: always(),
  description:
    "Prove durability by checkpointing the current OpenShell workspace into MongoDB GridFS, deleting that exact sandbox, creating a differently named sandbox, and restoring the checkpoint. Use only when the user explicitly asks for the survival demonstration.",
  inputSchema: z.object({
    reason: z.string().min(3).max(240),
  }),
  async execute({ reason }, ctx) {
    return replaceOpenShellSandbox({
      reason,
      scope: requireTenantScope(ctx),
      sessionId: ctx.session.id,
    });
  },
});
