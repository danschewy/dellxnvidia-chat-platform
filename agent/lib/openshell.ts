import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  latestWorkspaceCheckpoint,
  storeWorkspaceCheckpoint,
  type SandboxManifest,
} from "./sandbox-checkpoints";
import { getCollection } from "./mongo";
import type { TenantScope } from "./tenant";

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const RESTORE_ARCHIVE = "/sandbox/eve-hub-restore.tgz";
const CHECKPOINT_ARCHIVE = "/sandbox/eve-hub-checkpoint.tgz";

interface OpenShellSandboxDocument {
  readonly createdAt: Date;
  readonly generation: number;
  readonly lastCheckpointId?: string;
  readonly lastHydratedCheckpointId?: string;
  readonly name: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: "active" | "deleted" | "failed";
  readonly tenantId: string;
  readonly updatedAt: Date;
  readonly workspaceId: string;
}

type OpenShellEventType =
  | "checkpointed"
  | "command_finished"
  | "created"
  | "deleted"
  | "restored";

interface OpenShellEventDocument {
  readonly at: Date;
  readonly checkpointId?: string;
  readonly event: OpenShellEventType;
  readonly exitCode?: number;
  readonly generation: number;
  readonly ownerId: string;
  readonly reason?: string;
  readonly sandboxName: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface OpenShellCommandResult {
  readonly checkpoint?: Pick<SandboxManifest, "bytes" | "checkpointId" | "sha256">;
  readonly exitCode: number;
  readonly sandboxName: string;
  readonly stderr: string;
  readonly stdout: string;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

function sandboxStem(scope: TenantScope, sessionId: string): string {
  return createHash("sha256")
    .update(`${scope.tenantId}:${scope.userId}:${scope.workspaceId}:${sessionId}`)
    .digest("hex")
    .slice(0, 12);
}

function sandboxName(scope: TenantScope, sessionId: string, generation: number): string {
  return `eve-${sandboxStem(scope, sessionId)}-g${generation}`;
}

async function recordOpenShellEvent(
  document: Pick<OpenShellSandboxDocument, "generation" | "name" | "sessionId">,
  scope: TenantScope,
  event: OpenShellEventType,
  details: Pick<OpenShellEventDocument, "checkpointId" | "exitCode" | "reason"> = {},
): Promise<void> {
  const events = await getCollection<OpenShellEventDocument>("openshell_events");
  await events.insertOne({
    at: new Date(),
    checkpointId: details.checkpointId,
    event,
    exitCode: details.exitCode,
    generation: document.generation,
    ownerId: scope.userId,
    reason: details.reason,
    sandboxName: document.name,
    sessionId: document.sessionId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
}

function appendBounded(current: Buffer[], chunk: Buffer): void {
  const used = current.reduce((total, item) => total + item.byteLength, 0);
  if (used >= MAX_CAPTURE_BYTES) return;
  current.push(chunk.subarray(0, MAX_CAPTURE_BYTES - used));
}

async function runProcess(
  executable: string,
  args: readonly string[],
  timeoutMs = 0,
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      env: { ...process.env, NO_COLOR: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => appendBounded(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => appendBounded(stderr, chunk));
    child.once("error", reject);
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    }
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function openshell(
  args: readonly string[],
  timeoutMs = 0,
): Promise<ProcessResult> {
  const result = await runProcess(process.env.OPENSHELL_BIN ?? "openshell", args, timeoutMs);
  return result;
}

async function requireSuccess(
  args: readonly string[],
  label: string,
  timeoutMs = 0,
): Promise<ProcessResult> {
  const result = await openshell(args, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

async function sandboxExists(name: string): Promise<boolean> {
  const result = await openshell(["sandbox", "get", name, "--output", "json"], 30_000);
  return result.exitCode === 0;
}

async function restoreLatestCheckpoint(
  document: OpenShellSandboxDocument,
  scope: TenantScope,
): Promise<void> {
  const latest = await latestWorkspaceCheckpoint(scope, document.sessionId);
  if (!latest || latest.manifest.checkpointId === document.lastHydratedCheckpointId) return;
  const temporary = await mkdtemp(join(tmpdir(), "eve-openshell-restore-"));
  const archivePath = join(temporary, "workspace.tgz");
  try {
    await writeFile(archivePath, latest.archive, { mode: 0o600 });
    await requireSuccess(
      ["sandbox", "upload", document.name, archivePath, RESTORE_ARCHIVE],
      "OpenShell checkpoint upload",
      120_000,
    );
    await requireSuccess(
      [
        "sandbox",
        "exec",
        "-n",
        document.name,
        "--workdir",
        "/sandbox",
        "--timeout",
        "120",
        "--no-tty",
        "--",
        "/bin/sh",
        "-lc",
        `mkdir -p /sandbox/workspace && tar -xzf ${RESTORE_ARCHIVE} -C /sandbox/workspace`,
      ],
      "OpenShell checkpoint restore",
      150_000,
    );
    const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
    await sandboxes.updateOne(
      { name: document.name },
      {
        $set: {
          lastHydratedCheckpointId: latest.manifest.checkpointId,
          updatedAt: new Date(),
        },
      },
    );
    await recordOpenShellEvent(document, scope, "restored", {
      checkpointId: latest.manifest.checkpointId,
    });
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

async function createSandbox(
  scope: TenantScope,
  sessionId: string,
  generation: number,
): Promise<OpenShellSandboxDocument> {
  const name = sandboxName(scope, sessionId, generation);
  const policy =
    process.env.EVE_OPENSHELL_POLICY ??
    resolve(process.cwd(), "deploy/openshell/eve-task-policy.yaml");
  const now = new Date();
  try {
    await requireSuccess(
      [
        "sandbox",
        "create",
        "--name",
        name,
        "--from",
        process.env.EVE_OPENSHELL_SOURCE ?? "base",
        "--policy",
        policy,
        "--no-auto-providers",
        "--detach",
        "--label",
        "app=eve-hub",
        "--label",
        `session=${sandboxStem(scope, sessionId)}`,
        "--output",
        "json",
      ],
      "OpenShell sandbox creation",
      10 * 60_000,
    );
    await requireSuccess(
      [
        "sandbox",
        "exec",
        "-n",
        name,
        "--workdir",
        "/sandbox",
        "--timeout",
        "60",
        "--no-tty",
        "--",
        "/bin/mkdir",
        "-p",
        "/sandbox/workspace",
      ],
      "OpenShell workspace initialization",
      90_000,
    );
  } catch (error) {
    const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
    await sandboxes.updateOne(
      { sessionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      {
        $set: { status: "failed", updatedAt: new Date() },
        $setOnInsert: {
          createdAt: now,
          generation,
          name,
          ownerId: scope.userId,
          sessionId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      },
      { upsert: true },
    );
    throw error;
  }

  const document: OpenShellSandboxDocument = {
    createdAt: now,
    generation,
    name,
    ownerId: scope.userId,
    sessionId,
    status: "active",
    tenantId: scope.tenantId,
    updatedAt: now,
    workspaceId: scope.workspaceId,
  };
  const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
  await sandboxes.replaceOne(
    {
      ownerId: scope.userId,
      sessionId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
    document,
    { upsert: true },
  );
  await recordOpenShellEvent(document, scope, "created");
  await restoreLatestCheckpoint(document, scope);
  return document;
}

async function ensureOpenShellSandbox(
  scope: TenantScope,
  sessionId: string,
): Promise<OpenShellSandboxDocument> {
  const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
  const existing = await sandboxes.findOne({
    ownerId: scope.userId,
    sessionId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
  if (existing?.status === "active" && (await sandboxExists(existing.name))) {
    await restoreLatestCheckpoint(existing, scope);
    return existing;
  }
  return createSandbox(scope, sessionId, (existing?.generation ?? -1) + 1);
}

async function checkpointOpenShellSandbox(
  document: OpenShellSandboxDocument,
  scope: TenantScope,
  reason: string,
): Promise<SandboxManifest> {
  await requireSuccess(
    [
      "sandbox",
      "exec",
      "-n",
      document.name,
      "--workdir",
      "/sandbox/workspace",
      "--timeout",
      "120",
      "--no-tty",
      "--",
      "/bin/tar",
      "-czf",
      CHECKPOINT_ARCHIVE,
      "-C",
      "/sandbox/workspace",
      ".",
    ],
    "OpenShell workspace archive",
    150_000,
  );
  const temporary = await mkdtemp(join(tmpdir(), "eve-openshell-save-"));
  const archivePath = join(temporary, "workspace.tgz");
  try {
    await requireSuccess(
      ["sandbox", "download", document.name, CHECKPOINT_ARCHIVE, archivePath],
      "OpenShell checkpoint download",
      120_000,
    );
    const archive = await readFile(archivePath);
    const manifest = await storeWorkspaceCheckpoint(archive, {
      reason,
      sandboxId: document.name,
      scope,
      sessionId: document.sessionId,
    });
    const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
    await sandboxes.updateOne(
      { name: document.name },
      {
        $set: {
          lastCheckpointId: manifest.checkpointId,
          lastHydratedCheckpointId: manifest.checkpointId,
          updatedAt: new Date(),
        },
      },
    );
    await recordOpenShellEvent(document, scope, "checkpointed", {
      checkpointId: manifest.checkpointId,
      reason,
    });
    return manifest;
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

export async function runOpenShellCommand(input: {
  readonly args: readonly string[];
  readonly executable: string;
  readonly reason: string;
  readonly scope: TenantScope;
  readonly sessionId: string;
  readonly timeoutSeconds: number;
}): Promise<OpenShellCommandResult> {
  const document = await ensureOpenShellSandbox(input.scope, input.sessionId);
  const result = await openshell(
    [
      "sandbox",
      "exec",
      "-n",
      document.name,
      "--workdir",
      "/sandbox/workspace",
      "--timeout",
      String(input.timeoutSeconds),
      "--no-tty",
      "--",
      input.executable,
      ...input.args,
    ],
    input.timeoutSeconds > 0 ? (input.timeoutSeconds + 30) * 1_000 : 0,
  );
  const checkpoint = await checkpointOpenShellSandbox(document, input.scope, input.reason);
  await recordOpenShellEvent(document, input.scope, "command_finished", {
    checkpointId: checkpoint.checkpointId,
    exitCode: result.exitCode,
    reason: input.reason,
  });
  return {
    checkpoint: {
      bytes: checkpoint.bytes,
      checkpointId: checkpoint.checkpointId,
      sha256: checkpoint.sha256,
    },
    exitCode: result.exitCode,
    sandboxName: document.name,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

export async function replaceOpenShellSandbox(input: {
  readonly reason: string;
  readonly scope: TenantScope;
  readonly sessionId: string;
}): Promise<{
  readonly checkpoint: Pick<SandboxManifest, "bytes" | "checkpointId" | "sha256">;
  readonly destroyedSandbox: string;
  readonly replacementSandbox: string;
}> {
  const current = await ensureOpenShellSandbox(input.scope, input.sessionId);
  const checkpoint = await checkpointOpenShellSandbox(current, input.scope, input.reason);
  await requireSuccess(
    ["sandbox", "delete", current.name],
    "OpenShell sandbox deletion",
    120_000,
  );
  const sandboxes = await getCollection<OpenShellSandboxDocument>("openshell_sandboxes");
  await sandboxes.updateOne(
    { name: current.name },
    { $set: { status: "deleted", updatedAt: new Date() } },
  );
  await recordOpenShellEvent(current, input.scope, "deleted", {
    checkpointId: checkpoint.checkpointId,
    reason: input.reason,
  });
  const replacement = await createSandbox(
    input.scope,
    input.sessionId,
    current.generation + 1,
  );
  return {
    checkpoint: {
      bytes: checkpoint.bytes,
      checkpointId: checkpoint.checkpointId,
      sha256: checkpoint.sha256,
    },
    destroyedSandbox: current.name,
    replacementSandbox: replacement.name,
  };
}
