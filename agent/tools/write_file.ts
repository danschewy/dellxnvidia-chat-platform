import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/defaults";
import { ensureSandboxHydrated } from "../lib/sandbox-runtime";

export default defineTool({
  ...writeFile,
  description:
    "Write a complete file in the isolated workspace. Important files are checkpointed to MongoDB after the turn.",
  async execute(input, ctx) {
    await ensureSandboxHydrated(ctx);
    return writeFile.execute(input, ctx);
  },
});
