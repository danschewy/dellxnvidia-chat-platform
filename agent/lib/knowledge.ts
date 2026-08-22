import type { ModelMessage } from "ai";
import type { Filter } from "mongodb";
import { embedText } from "./embeddings";
import { getCollection } from "./mongo";
import type { TenantScope } from "./tenant";

export type KnowledgeKind = "business" | "convention" | "task_example";

export interface KnowledgeChunk {
  readonly approved: boolean;
  readonly chunkIndex: number;
  readonly content: string;
  readonly createdAt: Date;
  readonly embedding?: number[];
  readonly kind: KnowledgeKind;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly ownerId: string;
  readonly sourceId: string;
  readonly sourceUrl?: string;
  readonly tenantId: string;
  readonly title: string;
  readonly triggers?: string[];
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

export interface RetrievedChunk extends Omit<KnowledgeChunk, "embedding"> {
  readonly score?: number;
}

function textFromContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

export function latestUserText(messages: readonly ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = textFromContent(message.content).trim();
    if (text) return text;
  }
  return "";
}

function baseFilter(scope: TenantScope, kind: KnowledgeKind): Filter<KnowledgeChunk> {
  return {
    approved: true,
    kind,
    ...(kind === "business" ? {} : { ownerId: scope.userId }),
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  };
}

export async function retrieveKnowledge(
  scope: TenantScope,
  query: string,
  kind: KnowledgeKind,
  limit = 6,
): Promise<RetrievedChunk[]> {
  const knowledge = await getCollection<KnowledgeChunk>("knowledge_chunks");
  if (process.env.MONGODB_VECTOR_SEARCH_ENABLED === "1") {
    try {
      const queryVector = await embedText(query, "query");
      return await knowledge
        .aggregate<RetrievedChunk>([
          {
            $vectorSearch: {
              index: "knowledge_vector",
              path: "embedding",
              queryVector,
              numCandidates: Math.max(limit * 12, 48),
              limit,
              filter: baseFilter(scope, kind),
            },
          },
          { $set: { score: { $meta: "vectorSearchScore" } } },
          { $unset: "embedding" },
        ])
        .toArray();
    } catch (error) {
      console.warn("[eve-hub] vector retrieval unavailable; using MongoDB text retrieval", error);
    }
  }

  const terms = query
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 3)
    .slice(0, 10);
  const textFilter = terms.length > 0 ? terms.join(" ") : query;
  try {
    const matches = await knowledge
      .find(
        { ...baseFilter(scope, kind), $text: { $search: textFilter } },
        { projection: { embedding: 0, score: { $meta: "textScore" } } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .toArray();
    if (matches.length > 0) return matches as RetrievedChunk[];
  } catch (error) {
    console.warn("[eve-hub] MongoDB text retrieval unavailable", error);
  }

  if (kind === "convention") {
    return (await knowledge
      .find(baseFilter(scope, kind), { projection: { embedding: 0 } })
      .sort({ updatedAt: -1 })
      .limit(Math.min(limit, 3))
      .toArray()) as RetrievedChunk[];
  }
  return [];
}

export async function saveConvention(
  scope: TenantScope,
  input: { readonly content: string; readonly title: string; readonly triggers: string[] },
): Promise<RetrievedChunk> {
  const knowledge = await getCollection<KnowledgeChunk>("knowledge_chunks");
  const sourceId = `convention:${input.title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")}`;
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(
      `${input.title}\nTriggers: ${input.triggers.join(", ")}\n${input.content}`,
      "document",
    );
  } catch (error) {
    console.warn("[eve-hub] convention saved without an embedding", error);
  }
  const now = new Date();
  const update: KnowledgeChunk = {
    approved: true,
    chunkIndex: 0,
    content: input.content,
    createdAt: now,
    embedding,
    kind: "convention",
    ownerId: scope.userId,
    sourceId,
    tenantId: scope.tenantId,
    title: input.title,
    triggers: input.triggers,
    updatedAt: now,
    workspaceId: scope.workspaceId,
  };
  const result = await knowledge.findOneAndUpdate(
    {
      chunkIndex: 0,
      ownerId: scope.userId,
      sourceId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
    {
      $set: { ...update, createdAt: undefined },
      $setOnInsert: { createdAt: now },
    },
    { returnDocument: "after", upsert: true },
  );
  if (!result) throw new Error("MongoDB did not return the saved convention.");
  const saved = { ...result };
  delete saved.embedding;
  return saved;
}
