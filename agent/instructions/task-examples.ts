import { defineDynamic, defineInstructions } from "eve/instructions";
import { latestUserText } from "../lib/knowledge";
import { retrieveTaskExamples } from "../lib/task-examples";
import { tenantScopeFromAuth } from "../lib/tenant";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const query = latestUserText(ctx.messages);
      if (!query) return null;
      const examples = await retrieveTaskExamples(
        tenantScopeFromAuth(ctx.session.auth.current),
        query,
      );
      if (examples.length === 0) return null;

      return defineInstructions({
        role: "system",
        content: [
          "Approved task demonstrations retrieved from MongoDB follow.",
          "Use relevant demonstrations as operating procedure, but adapt to the current request, current UI state, and current permissions. Verify evidence after consequential steps.",
          ...examples.map(
            (example, index) =>
              `<task-demonstration rank="${index + 1}" title=${JSON.stringify(example.title)}>\n${example.content}\n</task-demonstration>`,
          ),
        ].join("\n\n"),
      });
    },
  },
});
