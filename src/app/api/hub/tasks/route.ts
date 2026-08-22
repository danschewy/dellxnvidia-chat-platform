import { getCollection } from "../../../../../agent/lib/mongo";
import { hubIdentityFromRequest, unauthorizedHubResponse } from "@/lib/hub-server";

interface TaskListItem {
  readonly checkpointId?: string;
  readonly createdAt: Date;
  readonly error?: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: "cancelled" | "completed" | "failed" | "running";
  readonly tenantId: string;
  readonly turnId: string;
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

export async function GET(request: Request) {
  const identity = hubIdentityFromRequest(request);
  if (!identity) return unauthorizedHubResponse();
  const scope = identity.scope;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const tasks = await getCollection<TaskListItem>("tasks");
  const items = await tasks
    .find({
      ownerId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      ...(sessionId ? { sessionId } : {}),
    })
    .project({ _id: 0 })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();
  return Response.json({ tasks: items });
}
