import { z } from "zod";
import { getCollection } from "../../../../../agent/lib/mongo";
import {
  saveTaskExample,
  type TaskExample,
} from "../../../../../agent/lib/task-examples";
import { hubIdentityFromRequest, unauthorizedHubResponse } from "@/lib/hub-server";

const taskExampleSchema = z.object({
  goal: z.string().min(10).max(1_000),
  steps: z
    .array(
      z.object({
        expectedEvidence: z.string().min(3).max(500).optional(),
        instruction: z.string().min(3).max(1_000),
        tool: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(30),
  title: z.string().min(3).max(120),
  triggers: z.array(z.string().min(2).max(100)).min(1).max(12),
});

export async function GET(request: Request) {
  const identity = hubIdentityFromRequest(request);
  if (!identity) return unauthorizedHubResponse();
  const scope = identity.scope;
  const examples = await getCollection<TaskExample>("task_examples");
  const items = await examples
    .find({
      ownerId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return Response.json({
    examples: items.map((item) => ({ ...item, _id: item._id?.toHexString() })),
  });
}

export async function POST(request: Request) {
  const identity = hubIdentityFromRequest(request);
  if (!identity) return unauthorizedHubResponse();
  const parsed = taskExampleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid task example.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const example = await saveTaskExample(identity.scope, parsed.data);
  return Response.json(
    { example: { ...example, _id: example._id?.toHexString() } },
    { status: 201 },
  );
}
