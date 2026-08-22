import { ObjectId } from "mongodb";
import { embedText } from "./embeddings";
import { type KnowledgeChunk, retrieveKnowledge } from "./knowledge";
import { getCollection } from "./mongo";
import type { TenantScope } from "./tenant";

export interface TaskExampleStep {
  readonly expectedEvidence?: string;
  readonly instruction: string;
  readonly tool?: string;
}

export interface TaskExample {
  readonly _id?: ObjectId;
  readonly approvedAt: Date;
  readonly createdAt: Date;
  readonly goal: string;
  readonly ownerId: string;
  readonly steps: TaskExampleStep[];
  readonly tenantId: string;
  readonly title: string;
  readonly triggers: string[];
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

export interface TaskExampleInput {
  readonly goal: string;
  readonly steps: TaskExampleStep[];
  readonly title: string;
  readonly triggers: string[];
}

function exampleContent(input: TaskExampleInput): string {
  return [
    `Task: ${input.title}`,
    `Goal: ${input.goal}`,
    `Use when: ${input.triggers.join(", ")}`,
    "Approved demonstration:",
    ...input.steps.map(
      (step, index) =>
        `${index + 1}. ${step.instruction}${step.tool ? ` [tool: ${step.tool}]` : ""}${step.expectedEvidence ? `\n   Verify: ${step.expectedEvidence}` : ""}`,
    ),
  ].join("\n");
}

export async function saveTaskExample(
  scope: TenantScope,
  input: TaskExampleInput,
): Promise<TaskExample> {
  const now = new Date();
  const taskExamples = await getCollection<TaskExample>("task_examples");
  const knowledge = await getCollection<KnowledgeChunk>("knowledge_chunks");
  const document: TaskExample = {
    approvedAt: now,
    createdAt: now,
    goal: input.goal,
    ownerId: scope.userId,
    steps: input.steps,
    tenantId: scope.tenantId,
    title: input.title,
    triggers: input.triggers,
    updatedAt: now,
    workspaceId: scope.workspaceId,
  };
  const inserted = await taskExamples.insertOne(document);
  const sourceId = `task-example:${inserted.insertedId.toHexString()}`;
  const content = exampleContent(input);
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(content, "document");
  } catch (error) {
    console.warn("[eve-hub] task example saved without an embedding", error);
  }
  await knowledge.insertOne({
    approved: true,
    chunkIndex: 0,
    content,
    createdAt: now,
    embedding,
    kind: "task_example",
    metadata: { taskExampleId: inserted.insertedId.toHexString() },
    ownerId: scope.userId,
    sourceId,
    tenantId: scope.tenantId,
    title: input.title,
    triggers: input.triggers,
    updatedAt: now,
    workspaceId: scope.workspaceId,
  });
  return { ...document, _id: inserted.insertedId };
}

export async function retrieveTaskExamples(scope: TenantScope, query: string) {
  return retrieveKnowledge(scope, query, "task_example", 4);
}
