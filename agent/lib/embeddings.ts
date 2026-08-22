const DEFAULT_EMBEDDING_URL = "http://127.0.0.1:8001/v1";
const DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-0.6B";

interface EmbeddingResponse {
  readonly data?: ReadonlyArray<{ readonly embedding?: number[]; readonly index?: number }>;
}

export async function embedText(text: string, mode: "document" | "query"): Promise<number[]> {
  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_URL).replace(/\/$/u, "");
  const input =
    mode === "query"
      ? `Instruct: Given a business knowledge query, retrieve relevant passages and organization conventions.\nQuery: ${text}`
      : text;
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.EMBEDDING_API_KEY ?? "local-only"}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input,
      model: process.env.EMBEDDING_MODEL_ID ?? DEFAULT_EMBEDDING_MODEL,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Local embedding service returned ${response.status}.`);
  }
  const payload = (await response.json()) as EmbeddingResponse;
  const embedding = [...(payload.data ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  )[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("Local embedding service returned no vector.");
  }
  return embedding;
}
