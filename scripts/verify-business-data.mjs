import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DATABASE ?? "eve_hub");
  const facts = await db.collection("business_facts").countDocuments();
  const chunks = await db.collection("knowledge_chunks").countDocuments({ kind: "business" });
  const embedded = await db
    .collection("knowledge_chunks")
    .countDocuments({ embedding: { $type: "array" }, kind: "business" });
  const sample = await db.collection("business_facts").findOne(
    { company: "NVIDIA CORP" },
    {
      projection: {
        _id: 0,
        company: 1,
        filedAt: 1,
        form: 1,
        metric: 1,
        sourceUrl: 1,
        unit: 1,
        value: 1,
      },
    },
  );
  if (facts < 3 || chunks < 3 || !sample?.sourceUrl?.startsWith("https://www.sec.gov/")) {
    throw new Error("Business-data verification failed.");
  }
  console.log(JSON.stringify({ chunks, embedded, facts, sample }, null, 2));
} finally {
  await client.close();
}
