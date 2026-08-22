import { defineTool } from "eve/tools";
import { glob } from "eve/tools/defaults";
import { ensureSandboxHydrated } from "../lib/sandbox-runtime";

export default defineTool({
  ...glob,
  async execute(input, ctx) {
    await ensureSandboxHydrated(ctx);
    return glob.execute(input, ctx);
  },
});
