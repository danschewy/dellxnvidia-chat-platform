import { defineTool } from "eve/tools";
import { grep } from "eve/tools/defaults";
import { ensureSandboxHydrated } from "../lib/sandbox-runtime";

export default defineTool({
  ...grep,
  async execute(input, ctx) {
    await ensureSandboxHydrated(ctx);
    return grep.execute(input, ctx);
  },
});
