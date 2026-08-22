import { defineDynamic, defineInstructions } from "eve/instructions";
import { capabilitiesFromTurn, persistCapabilityGrant } from "../lib/capabilities";
import { tenantScopeFromAuth } from "../lib/tenant";

function turnIdFromEvent(event: unknown): string {
  const data =
    event && typeof event === "object" && "data" in event
      ? (event as { data?: unknown }).data
      : undefined;
  const turnId =
    data && typeof data === "object" && "turnId" in data
      ? (data as { turnId?: unknown }).turnId
      : undefined;
  if (typeof turnId !== "string") throw new Error("turn.started did not include a turn id.");
  return turnId;
}

export default defineDynamic({
  events: {
    "turn.started": async (event, ctx) => {
      const capabilities = capabilitiesFromTurn(ctx.messages);
      await persistCapabilityGrant(
        ctx.session.id,
        turnIdFromEvent(event),
        tenantScopeFromAuth(ctx.session.auth.current),
        capabilities,
      );
      return defineInstructions({
        role: "system",
        content: [
          "The following user-controlled capabilities apply only to this turn.",
          JSON.stringify(capabilities),
          "A disabled capability is a hard prohibition. Tool executors independently enforce these grants.",
        ].join("\n"),
      });
    },
  },
});
