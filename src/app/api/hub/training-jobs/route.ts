import { getCollection } from "../../../../../agent/lib/mongo";
import type { TaskExample } from "../../../../../agent/lib/task-examples";
import { hubIdentityFromRequest, unauthorizedHubResponse } from "@/lib/hub-server";

interface TrainingPreview {
  readonly baseModel: string;
  readonly createdAt: Date;
  readonly datasetRows: number;
  readonly estimatedMinutes: number;
  readonly mode: "lora-preview";
  readonly ownerId: string;
  readonly status: "simulated";
  readonly tenantId: string;
  readonly title: string;
  readonly workspaceId: string;
}

export async function POST(request: Request) {
  const identity = hubIdentityFromRequest(request);
  if (!identity) return unauthorizedHubResponse();
  const scope = identity.scope;
  const examples = await getCollection<TaskExample>("task_examples");
  const datasetRows = await examples.countDocuments({
    ownerId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
  const preview: TrainingPreview = {
    baseModel: process.env.QWEN_MODEL_ID ?? "Qwen3.6-35B-A3B-NVFP4",
    createdAt: new Date(),
    datasetRows,
    estimatedMinutes: Math.max(12, Math.ceil(datasetRows * 1.5)),
    mode: "lora-preview",
    ownerId: scope.userId,
    status: "simulated",
    tenantId: scope.tenantId,
    title: `Task adapter preview · ${datasetRows} examples`,
    workspaceId: scope.workspaceId,
  };
  const jobs = await getCollection<TrainingPreview>("training_jobs");
  const inserted = await jobs.insertOne(preview);
  return Response.json(
    {
      job: { ...preview, _id: inserted.insertedId.toHexString() },
      note: "Preview only: no model weights were changed. Approved examples are already active through MongoDB retrieval.",
    },
    { status: 201 },
  );
}
