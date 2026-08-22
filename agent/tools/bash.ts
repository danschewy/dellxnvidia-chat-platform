import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { ensureSandboxHydrated } from "../lib/sandbox-runtime";

export default defineTool({
  ...bash,
  description:
    "Run a shell command in the network-isolated workspace. The workspace is restored from its latest MongoDB checkpoint before execution.",
  async execute(input, ctx) {
    await ensureSandboxHydrated(ctx);
    return bash.execute(input, ctx);
  },
});
