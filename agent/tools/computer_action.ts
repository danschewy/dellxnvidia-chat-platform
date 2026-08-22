import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { requireTurnCapability } from "../lib/capabilities";
import { invokeOpenClawComputerAction, projectOpenClawResult } from "../lib/openclaw";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    displayFrameId: z.string().min(1),
    button: z.enum(["left", "right", "double"]).default("left"),
    type: z.literal("click"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  z.object({
    text: z.string().min(1).max(4_000),
    type: z.literal("type_text"),
  }),
  z.object({
    keys: z.string().min(1).max(120),
    type: z.literal("hotkey"),
  }),
  z.object({
    application: z.string().min(1).max(120),
    type: z.literal("open_app"),
  }),
  z.object({
    displayFrameId: z.string().min(1).optional(),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(100).default(3),
    type: z.literal("scroll"),
    x: z.number().int().nonnegative().optional(),
    y: z.number().int().nonnegative().optional(),
  }),
]);

export default defineTool({
  approval: always(),
  description:
    "Perform one narrowly-scoped mouse, keyboard, or app-launch action on the user's Mac. Requires computerUse permission for this turn and explicit approval for every call.",
  inputSchema: z.object({
    action: actionSchema,
    nodeId: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(240),
  }),
  async execute({ action, nodeId }, ctx) {
    await requireTurnCapability(ctx, "computerUse");
    const wireAction = (() => {
      switch (action.type) {
        case "click":
          return {
            action:
              action.button === "right"
                ? "right_click"
                : action.button === "double"
                  ? "double_click"
                  : "left_click",
            displayFrameId: action.displayFrameId,
            refWidth: 1568,
            screenIndex: 0,
            x: action.x,
            y: action.y,
          };
        case "type_text":
          return { action: "type", refWidth: 1568, screenIndex: 0, text: action.text };
        case "hotkey":
          return { action: "key", keys: action.keys, refWidth: 1568, screenIndex: 0 };
        case "open_app":
          return { action: "launch_app", app: action.application };
        case "scroll":
          return {
            action: "scroll",
            displayFrameId: action.displayFrameId,
            refWidth: 1568,
            screenIndex: 0,
            scrollAmount: action.amount,
            scrollDirection: action.direction,
            ...(action.x === undefined ? {} : { x: action.x }),
            ...(action.y === undefined ? {} : { y: action.y }),
          };
      }
    })();
    return invokeOpenClawComputerAction(ctx.session.id, wireAction, nodeId);
  },
  toModelOutput(result) {
    const projected = projectOpenClawResult(result);
    return toolOutput.content([
      toolOutputPart.text(projected.summary),
      ...projected.images.map((image) =>
        toolOutputPart.file(image.base64, { mediaType: image.mediaType }),
      ),
    ]);
  },
});
