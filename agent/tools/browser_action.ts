import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { requireTurnCapability } from "../lib/capabilities";
import { invokeOpenClawComputerAction, projectOpenClawResult } from "../lib/openclaw";

const browserAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("browser_prepare"),
    profile: z.enum(["isolated_new", "isolated_named"]).default("isolated_new"),
    profileName: z.string().regex(/^[A-Za-z0-9._-]+$/u).max(64).optional(),
    windowRef: z.string().min(1),
  }),
  z.object({
    action: z.literal("browser_navigate"),
    browserRef: z.string().min(1),
    pageRef: z.string().min(1),
    url: z.url(),
  }),
  z.object({
    action: z.literal("browser_click"),
    browserRef: z.string().min(1),
    coordinate: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
    elementRef: z.string().min(1).optional(),
    inputRoute: z.enum(["trusted", "dom_event"]).default("trusted"),
    observationId: z.string().min(1),
    pageRef: z.string().min(1),
  }).refine((value) => value.elementRef || value.coordinate, {
    message: "browser_click requires elementRef or coordinate",
  }),
  z.object({
    action: z.literal("browser_type"),
    browserRef: z.string().min(1),
    elementRef: z.string().min(1),
    mode: z.enum(["insert_text", "keystrokes"]).default("insert_text"),
    observationId: z.string().min(1),
    pageRef: z.string().min(1),
    replace: z.boolean().default(false),
    text: z.string().max(8_000),
  }),
]);

export default defineTool({
  approval: always(),
  description:
    "Perform one approved action in an isolated OpenClaw CUA browser. Observe again after navigation or any stale-reference response.",
  inputSchema: z.object({
    browserAction,
    nodeId: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(240),
  }),
  async execute({ browserAction: action, nodeId }, ctx) {
    await requireTurnCapability(ctx, "browserUse");
    const wireAction =
      action.action === "browser_click" && action.coordinate
        ? {
            ...action,
            x: action.coordinate[0],
            y: action.coordinate[1],
            coordinate: undefined,
          }
        : action;
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
