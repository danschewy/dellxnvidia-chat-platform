import { getCollection } from "../../../../../agent/lib/mongo";
import { hubIdentityFromRequest, unauthorizedHubResponse } from "@/lib/hub-server";

interface ConversationListItem {
  readonly createdAt: Date;
  readonly lastMessage?: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: "active" | "completed" | "failed";
  readonly tenantId: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

export async function GET(request: Request) {
  const identity = hubIdentityFromRequest(request);
  if (!identity) return unauthorizedHubResponse();
  const scope = identity.scope;
  const conversations = await getCollection<ConversationListItem>("conversations");
  const items = await conversations
    .find(
      {
        ownerId: scope.userId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
      {
        projection: {
          _id: 0,
          createdAt: 1,
          lastMessage: 1,
          sessionId: 1,
          status: 1,
          title: 1,
          updatedAt: 1,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .limit(60)
    .toArray();
  return Response.json({ conversations: items });
}
