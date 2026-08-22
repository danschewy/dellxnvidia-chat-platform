import { defineTool } from "eve/tools";
import { once } from "eve/tools/approval";
import { z } from "zod";
import { requireTurnCapability } from "../lib/capabilities";

interface EmailSummary {
  readonly from: string;
  readonly id: string;
  readonly receivedAt?: string;
  readonly snippet: string;
  readonly subject: string;
  readonly url?: string;
}

async function searchGmail(query: string, count: number, token: string): Promise<EmailSummary[]> {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(count));
  const headers = { authorization: `Bearer ${token}` };
  const listResponse = await fetch(listUrl, { headers, signal: AbortSignal.timeout(15_000) });
  if (!listResponse.ok) throw new Error(`Gmail returned ${listResponse.status}`);
  const list = (await listResponse.json()) as { messages?: Array<{ id: string }> };

  return Promise.all(
    (list.messages ?? []).slice(0, count).map(async ({ id }) => {
      const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      messageUrl.searchParams.set("format", "metadata");
      messageUrl.searchParams.append("metadataHeaders", "From");
      messageUrl.searchParams.append("metadataHeaders", "Subject");
      messageUrl.searchParams.append("metadataHeaders", "Date");
      const response = await fetch(messageUrl, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Gmail message lookup returned ${response.status}`);
      const message = (await response.json()) as {
        payload?: { headers?: Array<{ name: string; value: string }> };
        snippet?: string;
      };
      const metadata = Object.fromEntries(
        (message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
      );
      return {
        from: metadata.from ?? "Unknown sender",
        id,
        receivedAt: metadata.date,
        snippet: message.snippet ?? "",
        subject: metadata.subject ?? "(No subject)",
        url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`,
      };
    }),
  );
}

async function searchMicrosoft(
  query: string,
  count: number,
  token: string,
): Promise<EmailSummary[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", `\"${query.replaceAll('"', "")}\"`);
  url.searchParams.set("$top", String(count));
  url.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview,webLink");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}`);
  const payload = (await response.json()) as {
    value?: Array<{
      bodyPreview?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      id: string;
      receivedDateTime?: string;
      subject?: string;
      webLink?: string;
    }>;
  };
  return (payload.value ?? []).map((message) => ({
    from:
      message.from?.emailAddress?.name ?? message.from?.emailAddress?.address ?? "Unknown sender",
    id: message.id,
    receivedAt: message.receivedDateTime,
    snippet: message.bodyPreview ?? "",
    subject: message.subject ?? "(No subject)",
    url: message.webLink,
  }));
}

export default defineTool({
  approval: once(),
  description:
    "Search the configured Gmail or Microsoft 365 inbox and return metadata/snippets only. Read-only. Only use when email is enabled for this turn.",
  inputSchema: z.object({
    count: z.number().int().min(1).max(10).default(5),
    query: z.string().min(1).max(300),
  }),
  async execute({ query, count }, ctx) {
    await requireTurnCapability(ctx, "email");
    const provider = process.env.EMAIL_PROVIDER;
    const token = process.env.EMAIL_ACCESS_TOKEN;
    if (!token || (provider !== "gmail" && provider !== "microsoft")) {
      throw new Error(
        "Email is not configured. Set EMAIL_PROVIDER to gmail or microsoft and provide EMAIL_ACCESS_TOKEN for the demo account.",
      );
    }
    const messages =
      provider === "gmail"
        ? await searchGmail(query, count, token)
        : await searchMicrosoft(query, count, token);
    return { messages, provider, query };
  },
});
