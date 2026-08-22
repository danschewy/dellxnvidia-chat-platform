import {
  type Collection,
  type Db,
  type Document,
  GridFSBucket,
  MongoClient,
} from "mongodb";

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017/?directConnection=true";
const DEFAULT_DATABASE = "eve_hub";

type MongoGlobal = typeof globalThis & {
  __eveHubMongoClient?: Promise<MongoClient>;
  __eveHubMongoIndexes?: Promise<void>;
};

const mongoGlobal = globalThis as MongoGlobal;

function clientPromise(): Promise<MongoClient> {
  if (!mongoGlobal.__eveHubMongoClient) {
    const client = new MongoClient(process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI, {
      appName: "eve-hub",
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS ?? 3_000),
      maxPoolSize: 20,
      minPoolSize: 1,
      serverSelectionTimeoutMS: Number(
        process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS ?? 3_000,
      ),
    });
    mongoGlobal.__eveHubMongoClient = client.connect().catch((error) => {
      mongoGlobal.__eveHubMongoClient = undefined;
      void client.close().catch(() => undefined);
      throw error;
    });
  }
  return mongoGlobal.__eveHubMongoClient;
}

export async function getMongoDb(): Promise<Db> {
  const client = await clientPromise();
  const db = client.db(process.env.MONGODB_DATABASE ?? DEFAULT_DATABASE);
  await ensureMongoIndexes(db);
  return db;
}

export async function getCollection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await getMongoDb()).collection<T>(name);
}

export async function getCheckpointBucket(): Promise<GridFSBucket> {
  return new GridFSBucket(await getMongoDb(), { bucketName: "sandbox_checkpoints" });
}

async function ensureMongoIndexes(db: Db): Promise<void> {
  mongoGlobal.__eveHubMongoIndexes ??= (async () => {
    await Promise.all([
      db.collection("agent_events").createIndex({ sessionId: 1, "meta.at": 1 }),
      db.collection("agent_events").createIndex({ tenantId: 1, workspaceId: 1, "meta.at": -1 }),
      db
        .collection("conversations")
        .createIndex({ tenantId: 1, workspaceId: 1, ownerId: 1, updatedAt: -1 }),
      db.collection("conversations").createIndex({ sessionId: 1 }, { unique: true }),
      db
        .collection("tasks")
        .createIndex({ tenantId: 1, workspaceId: 1, ownerId: 1, updatedAt: -1 }),
      db.collection("tasks").createIndex({ sessionId: 1, turnId: 1 }, { unique: true }),
      db
        .collection("task_examples")
        .createIndex({ tenantId: 1, workspaceId: 1, ownerId: 1, updatedAt: -1 }),
      db
        .collection("training_jobs")
        .createIndex({ tenantId: 1, workspaceId: 1, ownerId: 1, createdAt: -1 }),
      db.collection("capability_grants").createIndex(
        { sessionId: 1, turnId: 1 },
        { unique: true },
      ),
      db.collection("capability_grants").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db
        .collection("knowledge_chunks")
        .createIndex({ tenantId: 1, workspaceId: 1, ownerId: 1, kind: 1 }),
      db.collection("knowledge_chunks").createIndex({ title: "text", content: "text", triggers: "text" }),
      db.collection("knowledge_chunks").createIndex(
        { tenantId: 1, workspaceId: 1, ownerId: 1, sourceId: 1, chunkIndex: 1 },
        { unique: true },
      ),
      db.collection("business_facts").createIndex(
        { tenantId: 1, workspaceId: 1, company: 1, fiscalYear: -1, form: 1 },
      ),
      db.collection("sandbox_manifests").createIndex(
        { tenantId: 1, workspaceId: 1, userId: 1, sessionId: 1, createdAt: -1 },
      ),
      db.collection("openshell_sandboxes").createIndex(
        { tenantId: 1, workspaceId: 1, ownerId: 1, sessionId: 1 },
        { unique: true },
      ),
      db.collection("openshell_sandboxes").createIndex(
        { tenantId: 1, workspaceId: 1, status: 1, updatedAt: -1 },
      ),
      db.collection("openshell_events").createIndex(
        { tenantId: 1, workspaceId: 1, ownerId: 1, sessionId: 1, at: -1 },
      ),
    ]);

    if (process.env.MONGODB_VECTOR_SEARCH_ENABLED === "1") {
      const knowledge = db.collection("knowledge_chunks");
      const existing = await knowledge.listSearchIndexes("knowledge_vector").toArray();
      if (existing.length === 0) {
        await knowledge.createSearchIndex({
          name: "knowledge_vector",
          type: "vectorSearch",
          definition: {
            fields: [
              {
                type: "vector",
                path: "embedding",
                numDimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1024),
                similarity: "cosine",
              },
              { type: "filter", path: "tenantId" },
              { type: "filter", path: "workspaceId" },
              { type: "filter", path: "ownerId" },
              { type: "filter", path: "kind" },
              { type: "filter", path: "approved" },
            ],
          },
        });
      }
    }
  })().catch((error) => {
    mongoGlobal.__eveHubMongoIndexes = undefined;
    throw error;
  });

  await mongoGlobal.__eveHubMongoIndexes;
}

export async function mongoHealth(): Promise<{
  database: string;
  ok: boolean;
}> {
  const db = await getMongoDb();
  const result = await db.command({ ping: 1 });
  return { database: db.databaseName, ok: result.ok === 1 };
}
