import { defineTool } from "eve/tools";
import { readFile } from "eve/tools/defaults";
import { ensureSandboxHydrated } from "../lib/sandbox-runtime";

export default defineTool({
  ...readFile,
  async execute(input, ctx) {
    await ensureSandboxHydrated(ctx);
    return readFile.execute(input, ctx);
  },
});
