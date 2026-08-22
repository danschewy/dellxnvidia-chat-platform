const DEFAULT_TIMEOUT_MS = 15_000;

export interface CompanionScreen {
  readonly capturedAt: string;
  readonly height: number;
  readonly imageBase64: string;
  readonly mediaType: "image/png";
  readonly width: number;
}

function companionConfig() {
  const baseUrl = process.env.MAC_COMPANION_URL;
  const token = process.env.MAC_COMPANION_TOKEN;

  if (!baseUrl || !token) {
    throw new Error(
      "The macOS companion is not configured. Set MAC_COMPANION_URL and MAC_COMPANION_TOKEN on the Eve runtime.",
    );
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

export async function callCompanion<T>(path: string, body?: unknown): Promise<T> {
  const { baseUrl, token } = companionConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`macOS companion returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}
