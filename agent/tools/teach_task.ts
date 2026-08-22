import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { saveTaskExample } from "../lib/task-examples";
import { requireTenantScope } from "../lib/tenant";

export default defineTool({
  approval: always(),
  description:
    "Approve a reusable task demonstration. It is stored and semantically retrieved from MongoDB so future matching tasks follow the demonstrated procedure.",
  inputSchema: z.object({
    goal: z.string().min(10).max(1_000),
    steps: z
      .array(
        z.object({
          expectedEvidence: z.string().min(3).max(500).optional(),
          instruction: z.string().min(3).max(1_000),
          tool: z.string().min(1).max(100).optional(),
        }),
      )
      .min(1)
      .max(30),
    title: z.string().min(3).max(120),
    triggers: z.array(z.string().min(2).max(100)).min(1).max(12),
  }),
  async execute(input, ctx) {
    return saveTaskExample(requireTenantScope(ctx), input);
  },
});
