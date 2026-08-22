import { defineDynamic } from "eve/tools";
import { capabilitiesFromTurn, persistCapabilityGrant } from "../lib/capabilities";
import { tenantScopeFromAuth } from "../lib/tenant";

function stepMetadata(event: unknown): { stepIndex: number; turnId: string } {
  const data =
    event && typeof event === "object" && "data" in event
      ? (event as { data?: unknown }).data
      : undefined;
  const stepIndex =
    data && typeof data === "object" && "stepIndex" in data
      ? (data as { stepIndex?: unknown }).stepIndex
      : undefined;
  const turnId =
    data && typeof data === "object" && "turnId" in data
      ? (data as { turnId?: unknown }).turnId
      : undefined;
  if (typeof stepIndex !== "number" || typeof turnId !== "string") {
    throw new Error("step.started did not include its step index and turn id.");
  }
  return { stepIndex, turnId };
}

export default defineDynamic({
  events: {
    "step.started": async (event, ctx) => {
      const { stepIndex, turnId } = stepMetadata(event);
      if (stepIndex !== 0) return null;
      await persistCapabilityGrant(
        ctx.session.id,
        turnId,
        tenantScopeFromAuth(ctx.session.auth.current),
        capabilitiesFromTurn(ctx.messages),
      );
      return null;
    },
  },
});
