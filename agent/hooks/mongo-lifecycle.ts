import { defineHook } from "eve/hooks";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { getCollection } from "../lib/mongo";
import { checkpointWorkspaceToMongo } from "../lib/sandbox-checkpoints";
import { tenantScopeFromAuth, type TenantScope } from "../lib/tenant";

interface ConversationDocument {
  readonly channel?: string;
  readonly createdAt: Date;
  readonly lastCheckpoint?: {
    readonly bytes: number;
    readonly checkpointId: string;
    readonly createdAt: Date;
  };
  readonly lastMessage?: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: "active" | "completed" | "failed";
  readonly tenantId: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

interface TaskDocument {
  readonly completedAt?: Date;
  readonly error?: string;
  readonly checkpointId?: string;
  readonly createdAt: Date;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: "cancelled" | "completed" | "failed" | "running";
  readonly tenantId: string;
  readonly turnId: string;
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

function scopeFor(ctx: {
  readonly session: {
    readonly auth: {
      readonly current: Parameters<typeof tenantScopeFromAuth>[0];
      readonly initiator: Parameters<typeof tenantScopeFromAuth>[0];
    };
  };
}): TenantScope {
  return tenantScopeFromAuth(ctx.session.auth.initiator ?? ctx.session.auth.current);
}

function titleFromMessage(message: string): string {
  const oneLine = message.replace(/\s+/gu, " ").trim();
  if (!oneLine) return "New conversation";
  return oneLine.length <= 72 ? oneLine : `${oneLine.slice(0, 69).trimEnd()}…`;
}

async function saveCheckpoint(
  sandbox: RuntimeSandboxSession,
  scope: TenantScope,
  sessionId: string,
  turnId: string,
): Promise<void> {
  const checkpoint = await checkpointWorkspaceToMongo(
    sandbox,
    scope,
    sessionId,
    `turn.completed:${turnId}`,
  );
  const now = new Date();
  const conversations = await getCollection<ConversationDocument>("conversations");
  const tasks = await getCollection<TaskDocument>("tasks");
  await Promise.all([
    conversations.updateOne(
      { sessionId },
      {
        $set: {
          lastCheckpoint: {
            bytes: checkpoint.bytes,
            checkpointId: checkpoint.checkpointId,
            createdAt: checkpoint.createdAt,
          },
          updatedAt: now,
        },
      },
    ),
    tasks.updateOne(
      { sessionId, turnId },
      { $set: { checkpointId: checkpoint.checkpointId, updatedAt: now } },
    ),
  ]);
}

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const scope = scopeFor(ctx);
      const now = new Date();
      const conversations = await getCollection<ConversationDocument>("conversations");
      await conversations.updateOne(
        { sessionId: ctx.session.id },
        {
          $set: { updatedAt: now },
          $setOnInsert: {
            channel: ctx.channel.kind,
            createdAt: now,
            ownerId: scope.userId,
            sessionId: ctx.session.id,
            status: "active",
            tenantId: scope.tenantId,
            title: "New conversation",
            workspaceId: scope.workspaceId,
          },
        },
        { upsert: true },
      );
    },

    async "message.received"(event, ctx) {
      const now = new Date();
      const conversations = await getCollection<ConversationDocument>("conversations");
      await conversations.updateOne(
        { sessionId: ctx.session.id },
        { $set: { lastMessage: event.data.message, status: "active", updatedAt: now } },
      );
      await conversations.updateOne(
        { sessionId: ctx.session.id, title: "New conversation" },
        { $set: { title: titleFromMessage(event.data.message) } },
      );
    },

    async "turn.started"(event, ctx) {
      const scope = scopeFor(ctx);
      const now = new Date();
      const tasks = await getCollection<TaskDocument>("tasks");
      await tasks.updateOne(
        { sessionId: ctx.session.id, turnId: event.data.turnId },
        {
          $set: { status: "running", updatedAt: now },
          $setOnInsert: {
            createdAt: now,
            ownerId: scope.userId,
            sessionId: ctx.session.id,
            tenantId: scope.tenantId,
            turnId: event.data.turnId,
            workspaceId: scope.workspaceId,
          },
        },
        { upsert: true },
      );
    },

    async "turn.completed"(event, ctx) {
      const now = new Date();
      const tasks = await getCollection<TaskDocument>("tasks");
      const conversations = await getCollection<ConversationDocument>("conversations");
      await Promise.all([
        tasks.updateOne(
          { sessionId: ctx.session.id, turnId: event.data.turnId },
          { $set: { completedAt: now, status: "completed", updatedAt: now } },
        ),
        conversations.updateOne(
          { sessionId: ctx.session.id },
          { $set: { status: "completed", updatedAt: now } },
        ),
      ]);

      if (process.env.EVE_FRAMEWORK_SANDBOX_CHECKPOINTS !== "1") return;

      try {
        await saveCheckpoint(
          await ctx.getSandbox(),
          scopeFor(ctx),
          ctx.session.id,
          event.data.turnId,
        );
      } catch (error) {
        console.error("[eve-hub] MongoDB sandbox checkpoint failed", error);
        await tasks.updateOne(
          { sessionId: ctx.session.id, turnId: event.data.turnId },
          {
            $set: {
              error: `The task completed, but its sandbox checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
              updatedAt: new Date(),
            },
          },
        );
      }
    },

    async "turn.failed"(event, ctx) {
      const now = new Date();
      const tasks = await getCollection<TaskDocument>("tasks");
      const conversations = await getCollection<ConversationDocument>("conversations");
      await Promise.all([
        tasks.updateOne(
          { sessionId: ctx.session.id, turnId: event.data.turnId },
          {
            $set: {
              completedAt: now,
              error: event.data.message ?? "The turn failed.",
              status: "failed",
              updatedAt: now,
            },
          },
        ),
        conversations.updateOne(
          { sessionId: ctx.session.id },
          { $set: { status: "failed", updatedAt: now } },
        ),
      ]);
    },

    async "turn.cancelled"(event, ctx) {
      const now = new Date();
      const tasks = await getCollection<TaskDocument>("tasks");
      const conversations = await getCollection<ConversationDocument>("conversations");
      await Promise.all([
        tasks.updateOne(
          { sessionId: ctx.session.id, turnId: event.data.turnId },
          { $set: { completedAt: now, status: "cancelled", updatedAt: now } },
        ),
        conversations.updateOne(
          { sessionId: ctx.session.id },
          { $set: { status: "completed", updatedAt: now } },
        ),
      ]);
    },

    async "session.failed"(_event, ctx) {
      const conversations = await getCollection<ConversationDocument>("conversations");
      await conversations.updateOne(
        { sessionId: ctx.session.id },
        { $set: { status: "failed", updatedAt: new Date() } },
      );
    },

    async "*"(event, ctx) {
      const scope = scopeFor(ctx);
      const events = await getCollection<{ _id: string } & Record<string, unknown>>("agent_events");
      await events.updateOne(
        { _id: event.meta.id },
        {
          $setOnInsert: {
            _id: event.meta.id,
            data: "data" in event ? event.data : null,
            meta: event.meta,
            ownerId: scope.userId,
            sessionId: ctx.session.id,
            tenantId: scope.tenantId,
            type: event.type,
            workspaceId: scope.workspaceId,
          },
        },
        { upsert: true },
      );
    },
  },
});
