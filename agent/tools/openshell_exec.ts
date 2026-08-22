import { defineTool } from "eve/tools";
import { once } from "eve/tools/approval";
import { z } from "zod";
import { runOpenShellCommand } from "../lib/openshell";
import { requireTenantScope } from "../lib/tenant";

export default defineTool({
  approval: once(),
  description:
    "Run a long-lived task phase in Eve's NVIDIA OpenShell sandbox. The sandbox has no arbitrary network egress. Its /sandbox/workspace is restored from MongoDB before execution and checkpointed back to MongoDB afterward, even when the command exits non-zero.",
  inputSchema: z.object({
    args: z.array(z.string().max(4_000)).max(100).default([]),
    executable: z.string().min(1).max(500),
    reason: z.string().min(3).max(240),
    timeoutSeconds: z.number().int().min(0).max(86_400).default(0),
  }),
  async execute({ args, executable, reason, timeoutSeconds }, ctx) {
    return runOpenShellCommand({
      args,
      executable,
      reason,
      scope: requireTenantScope(ctx),
      sessionId: ctx.session.id,
      timeoutSeconds,
    });
  },
});
