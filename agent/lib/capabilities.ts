import type { ModelMessage } from "ai";
import type { SessionContext } from "eve/context";
import { getCollection } from "./mongo";
import { requireTenantScope, type TenantScope } from "./tenant";

export type EveHubCapability =
  | "browserUse"
  | "computerUse"
  | "email"
  | "screenContext"
  | "webSearch";

export type EveHubCapabilities = Readonly<Record<EveHubCapability, boolean>>;

interface CapabilityGrantDocument extends EveHubCapabilities {
  readonly expiresAt: Date;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly workspaceId: string;
}

const DISABLED_CAPABILITIES: EveHubCapabilities = {
  browserUse: false,
  computerUse: false,
  email: false,
  screenContext: false,
  webSearch: false,
};

const CLIENT_CONTEXT_PREFIX = "Client context:\n";

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

export function capabilitiesFromTurn(messages: readonly ModelMessage[]): EveHubCapabilities {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "assistant") break;
    if (message.role !== "user") continue;
    const raw = textFromMessage(message).trim();
    if (!raw.startsWith(CLIENT_CONTEXT_PREFIX)) continue;
    const serializedContext = raw.slice(CLIENT_CONTEXT_PREFIX.length).trim();
    if (!serializedContext.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(serializedContext) as {
        eveHubCapabilities?: Record<string, unknown>;
      };
      const source = parsed.eveHubCapabilities;
      if (!source) continue;
      return {
        browserUse: source.browserUse === true,
        computerUse: source.computerUse === true,
        email: source.email === true,
        screenContext: source.screenContext === true,
        webSearch: source.webSearch === true,
      };
    } catch {
      continue;
    }
  }
  return DISABLED_CAPABILITIES;
}

export async function persistCapabilityGrant(
  sessionId: string,
  turnId: string,
  scope: TenantScope,
  capabilities: EveHubCapabilities,
): Promise<void> {
  const grants = await getCollection<CapabilityGrantDocument>("capability_grants");
  await grants.updateOne(
    { sessionId, turnId },
    {
      $set: {
        ...capabilities,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        ownerId: scope.userId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
      $setOnInsert: { sessionId, turnId },
    },
    { upsert: true },
  );
}

export async function requireTurnCapability(
  ctx: SessionContext,
  capability: EveHubCapability,
): Promise<void> {
  const scope = requireTenantScope(ctx);
  const grants = await getCollection<CapabilityGrantDocument>("capability_grants");
  const grant = await grants.findOne({
    sessionId: ctx.session.id,
    tenantId: scope.tenantId,
    turnId: ctx.session.turn.id,
    workspaceId: scope.workspaceId,
  });
  if (grant?.[capability] !== true) {
    throw new Error(
      `${capability} is disabled for this turn. The user must enable it in the composer and send a new request.`,
    );
  }
}
