import { defineDynamic, defineInstructions } from "eve/instructions";

export default defineDynamic({
  events: {
    "turn.started": () => {
      return defineInstructions({
        role: "system",
        content: [
          "The latest Client context JSON contains eveHubCapabilities for this turn.",
          "Read those booleans as the current capabilities object.",
          "A disabled capability is a hard prohibition. Tool executors independently enforce these grants.",
        ].join("\n"),
      });
    },
  },
});
