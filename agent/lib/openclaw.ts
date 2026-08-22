import { createHash, randomUUID } from "node:crypto";

const OPENCLAW_PROTOCOL_VERSION = 4;
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface GatewayError {
  readonly code?: string;
  readonly details?: unknown;
  readonly message?: string;
  readonly retryable?: boolean;
}

interface GatewayResponse {
  readonly error?: GatewayError;
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly type: "res";
}

interface GatewayEvent {
  readonly event: string;
  readonly payload?: unknown;
  readonly type: "event";
}

interface PendingRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface OpenClawNode {
  readonly active?: boolean;
  readonly commands?: string[];
  readonly computerUse?: {
    readonly actions?: string[];
    readonly observations?: string[];
    readonly provider?: { readonly generation?: string; readonly id?: string };
  };
  readonly connected?: boolean;
  readonly displayName?: string;
  readonly nodeId: string;
  readonly platform?: string;
}

interface NodeListResult {
  readonly activeNodeId?: string;
  readonly nodes: OpenClawNode[];
  readonly ts: number;
}

interface NodeInvokeResult {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly payloadJSON?: string | null;
}

export interface OpenClawScreen {
  readonly base64: string;
  readonly capturedAtMs?: number;
  readonly displayFrameId?: string;
  readonly format: string;
  readonly height: number;
  readonly nodeId: string;
  readonly screenIndex: number;
  readonly width: number;
}

type GatewayFrame = GatewayEvent | GatewayResponse | { readonly type?: string };

class OpenClawGatewayClient {
  private connectPromise: Promise<void> | null = null;
  private connectRequestId: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private socket: WebSocket | null = null;

  async request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw Gateway connection is not open.");
    }
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenClaw Gateway request ${method} timed out.`));
      }, Number(process.env.OPENCLAW_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS));
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as T),
        timer,
      });
      socket.send(JSON.stringify({ id, method, params, type: "req" }));
    });
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && !this.connectRequestId) return;
    if (this.connectPromise) return this.connectPromise;

    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN is not configured.");
    const url = process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
    if (!/^wss?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(url)) {
      throw new Error(
        "The hackathon OpenClaw bridge only accepts a loopback Gateway URL. Use an SSH/private forward.",
      );
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const deadline = setTimeout(() => {
        socket.close();
        reject(new Error("OpenClaw Gateway handshake timed out."));
      }, 15_000);

      const fail = (error: Error) => {
        clearTimeout(deadline);
        this.connectPromise = null;
        this.connectRequestId = null;
        reject(error);
      };

      socket.addEventListener("error", () => fail(new Error("Could not connect to OpenClaw Gateway.")), {
        once: true,
      });
      socket.addEventListener("close", () => {
        clearTimeout(deadline);
        this.socket = null;
        this.connectPromise = null;
        this.connectRequestId = null;
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("OpenClaw Gateway connection closed."));
          this.pending.delete(id);
        }
      });
      socket.addEventListener("message", (message) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(String(message.data)) as GatewayFrame;
        } catch {
          return;
        }

        if (frame.type === "event" && (frame as GatewayEvent).event === "connect.challenge") {
          if (this.connectRequestId) return;
          const id = randomUUID();
          this.connectRequestId = id;
          socket.send(
            JSON.stringify({
              type: "req",
              id,
              method: "connect",
              params: {
                minProtocol: OPENCLAW_PROTOCOL_VERSION,
                maxProtocol: OPENCLAW_PROTOCOL_VERSION,
                client: {
                  id: "gateway-client",
                  version: "0.1.0",
                  platform: "linux",
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.read", "operator.write"],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token },
                locale: "en-US",
                userAgent: "eve-hub/0.1.0",
              },
            }),
          );
          return;
        }

        if (frame.type !== "res") return;
        const response = frame as GatewayResponse;
        if (response.id === this.connectRequestId) {
          clearTimeout(deadline);
          this.connectRequestId = null;
          if (!response.ok) {
            fail(new Error(response.error?.message ?? "OpenClaw Gateway rejected the handshake."));
            return;
          }
          this.connectPromise = null;
          resolve();
          return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        if (response.ok) {
          pending.resolve(response.payload);
        } else {
          pending.reject(
            new Error(
              `${response.error?.code ? `${response.error.code}: ` : ""}${response.error?.message ?? "OpenClaw Gateway request failed."}`,
            ),
          );
        }
      });
    });

    return this.connectPromise;
  }
}

type OpenClawGlobal = typeof globalThis & { __eveOpenClawClient?: OpenClawGatewayClient };
const openClawGlobal = globalThis as OpenClawGlobal;

function gatewayClient(): OpenClawGatewayClient {
  openClawGlobal.__eveOpenClawClient ??= new OpenClawGatewayClient();
  return openClawGlobal.__eveOpenClawClient;
}

function executionIdForSession(sessionId: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`eve-hub:${sessionId}`).digest("hex").slice(0, 32));
  bytes[12] = "5".charCodeAt(0);
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(String.fromCharCode(bytes[16]!), 16) % 4]!.charCodeAt(0);
  const hex = bytes.toString();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function nodeWithCommands(
  requiredCommands: readonly string[],
  requestedNodeId?: string,
): Promise<OpenClawNode> {
  const result = await gatewayClient().request<NodeListResult>("node.list", {});
  const configured = requestedNodeId ?? process.env.OPENCLAW_NODE_ID;
  const candidates = result.nodes.filter(
    (node) =>
      node.connected &&
      requiredCommands.every((command) => node.commands?.includes(command)),
  );
  const node = configured
    ? candidates.find((candidate) => candidate.nodeId === configured)
    : candidates.find((candidate) => candidate.nodeId === result.activeNodeId) ??
      candidates.find((candidate) => candidate.active) ??
      candidates[0];
  if (!node) {
    throw new Error(
      `No paired OpenClaw node is connected with ${requiredCommands.join(" and ")} enabled.`,
    );
  }
  return node;
}

function screenNode(requestedNodeId?: string): Promise<OpenClawNode> {
  return nodeWithCommands(["screen.snapshot"], requestedNodeId);
}

function computerNode(requestedNodeId?: string): Promise<OpenClawNode> {
  return nodeWithCommands(["screen.snapshot", "computer.act"], requestedNodeId);
}

function parseNodePayload(result: NodeInvokeResult): unknown {
  if (!result.ok) {
    throw new Error(
      `${result.error?.code ? `${result.error.code}: ` : ""}${result.error?.message ?? "OpenClaw node invocation failed."}`,
    );
  }
  if (result.payload !== undefined) return result.payload;
  if (result.payloadJSON) return JSON.parse(result.payloadJSON) as unknown;
  return { ok: true };
}

async function invokeNode(
  nodeId: string,
  command: string,
  params: Readonly<Record<string, unknown>>,
  idempotencyKey = randomUUID(),
): Promise<unknown> {
  const result = await gatewayClient().request<NodeInvokeResult>("node.invoke", {
    nodeId,
    command,
    params,
    timeoutMs: Number(process.env.OPENCLAW_NODE_TIMEOUT_MS ?? 45_000),
    idempotencyKey,
  });
  return parseNodePayload(result);
}

export async function captureOpenClawScreen(
  sessionId: string,
  options: { readonly nodeId?: string; readonly screenIndex?: number } = {},
): Promise<OpenClawScreen> {
  const node = await screenNode(options.nodeId);
  const screenIndex = options.screenIndex ?? 0;
  const payload = (await invokeNode(node.nodeId, "screen.snapshot", {
    executionId: executionIdForSession(sessionId),
    format: "jpeg",
    maxWidth: 1568,
    quality: 82,
    screenIndex,
  })) as Partial<Omit<OpenClawScreen, "nodeId" | "screenIndex">>;
  if (
    typeof payload.base64 !== "string" ||
    typeof payload.format !== "string" ||
    typeof payload.height !== "number" ||
    typeof payload.width !== "number"
  ) {
    throw new Error("OpenClaw screen.snapshot returned an invalid payload.");
  }
  return {
    base64: payload.base64,
    capturedAtMs: payload.capturedAtMs,
    displayFrameId: payload.displayFrameId,
    format: payload.format,
    height: payload.height,
    nodeId: node.nodeId,
    screenIndex,
    width: payload.width,
  };
}

export async function invokeOpenClawComputerAction(
  sessionId: string,
  action: Readonly<Record<string, unknown>>,
  requestedNodeId?: string,
): Promise<unknown> {
  const node = await computerNode(requestedNodeId);
  const advertised = node.computerUse?.actions;
  if (advertised && typeof action.action === "string" && !advertised.includes(action.action)) {
    throw new Error(`The paired Mac does not advertise the ${action.action} computer action.`);
  }
  return invokeNode(node.nodeId, "computer.act", {
    ...action,
    executionId: executionIdForSession(sessionId),
  });
}

function collectImages(value: unknown, images: Array<{ base64: string; mediaType: string }>): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.base64 === "string" && record.base64.length > 100) {
    const format = typeof record.format === "string" ? record.format : "png";
    images.push({
      base64: record.base64,
      mediaType: format.includes("jpeg") || format.includes("jpg") ? "image/jpeg" : "image/png",
    });
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key !== "base64") collectImages(nested, images);
  }
}

function redactImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImages);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      key === "base64" && typeof nested === "string" ? "[image attached]" : redactImages(nested),
    ]),
  );
}

export function projectOpenClawResult(result: unknown): {
  readonly images: ReadonlyArray<{ readonly base64: string; readonly mediaType: string }>;
  readonly summary: string;
} {
  const images: Array<{ base64: string; mediaType: string }> = [];
  collectImages(result, images);
  return { images, summary: JSON.stringify(redactImages(result), null, 2) };
}
