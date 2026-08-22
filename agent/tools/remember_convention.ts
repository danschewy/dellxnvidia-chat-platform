import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { saveConvention } from "../lib/knowledge";
import { requireTenantScope } from "../lib/tenant";

export default defineTool({
  approval: always(),
  description:
    "Save or update an approved organization convention in MongoDB. Retrieved conventions can change response format and operating behavior in future conversations.",
  inputSchema: z.object({
    title: z.string().min(3).max(120),
    triggers: z.array(z.string().min(2).max(80)).min(1).max(12),
    content: z.string().min(10).max(4_000),
  }),
  async execute(input, ctx) {
    const role = ctx.session.auth.current?.attributes.role;
    if (role !== "admin") {
      throw new Error("Only a workspace administrator can approve behavior conventions.");
    }
    return saveConvention(requireTenantScope(ctx), input);
  },
});
