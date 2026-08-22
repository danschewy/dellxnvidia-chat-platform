import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireTurnCapability } from "../lib/capabilities";

interface SearchResult {
  readonly publishedAt?: string;
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

const inputSchema = z.object({
  count: z.number().int().min(1).max(8).default(5),
  query: z.string().min(2).max(400),
});

async function searchSearxng(query: string, count: number): Promise<SearchResult[]> {
  const baseUrl = process.env.SEARXNG_BASE_URL!.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);
  const payload = (await response.json()) as {
    results?: Array<{ content?: string; publishedDate?: string; title?: string; url?: string }>;
  };

  return (payload.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, count)
    .map((item) => ({
      publishedAt: item.publishedDate,
      snippet: item.content ?? "",
      title: item.title!,
      url: item.url!,
    }));
}

async function searchBrave(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Brave Search returned ${response.status}`);
  const payload = (await response.json()) as {
    web?: { results?: Array<{ age?: string; description?: string; title: string; url: string }> };
  };

  return (payload.web?.results ?? []).slice(0, count).map((item) => ({
    publishedAt: item.age,
    snippet: item.description ?? "",
    title: item.title,
    url: item.url,
  }));
}

export default defineTool({
  description:
    "Search the public web. Only call when webSearch is enabled for this turn. Use returned URLs as citations.",
  inputSchema,
  async execute({ query, count }, ctx) {
    await requireTurnCapability(ctx, "webSearch");
    if (process.env.SEARXNG_BASE_URL) {
      return { provider: "searxng", query, results: await searchSearxng(query, count) };
    }
    if (process.env.BRAVE_SEARCH_API_KEY) {
      return { provider: "brave", query, results: await searchBrave(query, count) };
    }
    throw new Error(
      "Web search is not configured. Set SEARXNG_BASE_URL for private search or BRAVE_SEARCH_API_KEY.",
    );
  },
});
