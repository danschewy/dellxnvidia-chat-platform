import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import type { SandboxSession } from "eve/sandbox";
import { ObjectId, type WithId } from "mongodb";
import { getCheckpointBucket, getCollection } from "./mongo";
import type { TenantScope } from "./tenant";

const ARCHIVE_PATH = "/tmp/eve-hub-workspace.tgz";
const MARKER_PATH = ".eve-hub/checkpoint.json";
const CHECKPOINTS_TO_KEEP = 5;

export interface SandboxManifest {
  readonly bytes: number;
  readonly checkpointId: string;
  readonly createdAt: Date;
  readonly fileId: ObjectId;
  readonly reason: string;
  readonly sandboxId: string;
  readonly sessionId: string;
  readonly sha256: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface CheckpointMarker {
  readonly checkpointId: string;
  readonly restoredAt: string;
  readonly sha256: string;
}

async function latestManifest(
  scope: TenantScope,
  sessionId: string,
): Promise<WithId<SandboxManifest> | null> {
  const manifests = await getCollection<SandboxManifest>("sandbox_manifests");
  return manifests.findOne(
    {
      sessionId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    },
    { sort: { createdAt: -1 } },
  );
}

export async function latestWorkspaceCheckpoint(
  scope: TenantScope,
  sessionId: string,
): Promise<{ archive: Buffer; manifest: WithId<SandboxManifest> } | null> {
  const manifest = await latestManifest(scope, sessionId);
  if (!manifest) return null;
  const bucket = await getCheckpointBucket();
  const chunks: Buffer[] = [];
  for await (const chunk of bucket.openDownloadStream(manifest.fileId)) {
    chunks.push(Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (sha256 !== manifest.sha256) {
    throw new Error(`Sandbox checkpoint ${manifest.checkpointId} failed its integrity check.`);
  }
  return { archive, manifest };
}

export async function storeWorkspaceCheckpoint(
  archive: Buffer,
  input: {
    readonly reason: string;
    readonly sandboxId: string;
    readonly scope: TenantScope;
    readonly sessionId: string;
  },
): Promise<SandboxManifest> {
  const { reason, sandboxId, scope, sessionId } = input;
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const checkpointId = new ObjectId().toHexString();
  const bucket = await getCheckpointBucket();
  const upload = bucket.openUploadStream(`${sessionId}-${checkpointId}.tgz`, {
    id: new ObjectId(checkpointId),
    metadata: {
      checkpointId,
      sessionId,
      sha256,
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    },
  });
  upload.end(archive);
  await finished(upload);

  const manifest: SandboxManifest = {
    bytes: archive.byteLength,
    checkpointId,
    createdAt: new Date(),
    fileId: upload.id,
    reason,
    sandboxId,
    sessionId,
    sha256,
    tenantId: scope.tenantId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  };
  const manifests = await getCollection<SandboxManifest>("sandbox_manifests");
  await manifests.insertOne(manifest);

  const expired = await manifests
    .find({
      sessionId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .sort({ createdAt: -1 })
    .skip(CHECKPOINTS_TO_KEEP)
    .toArray();
  if (expired.length > 0) {
    await Promise.all(expired.map((item) => bucket.delete(item.fileId)));
    await manifests.deleteMany({ _id: { $in: expired.map((item) => item._id) } });
  }
  return manifest;
}

async function readMarker(sandbox: SandboxSession): Promise<CheckpointMarker | null> {
  const raw = await sandbox.readTextFile({ path: MARKER_PATH });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckpointMarker;
  } catch {
    return null;
  }
}

async function writeMarker(
  sandbox: SandboxSession,
  manifest: Pick<SandboxManifest, "checkpointId" | "sha256">,
): Promise<void> {
  await sandbox.writeTextFile({
    path: MARKER_PATH,
    content: `${JSON.stringify(
      {
        checkpointId: manifest.checkpointId,
        restoredAt: new Date().toISOString(),
        sha256: manifest.sha256,
      } satisfies CheckpointMarker,
      null,
      2,
    )}\n`,
  });
}

export async function hydrateWorkspaceFromMongo(
  sandbox: SandboxSession,
  scope: TenantScope,
  sessionId: string,
): Promise<{ checkpointId?: string; restored: boolean }> {
  const manifest = await latestManifest(scope, sessionId);
  if (!manifest) return { restored: false };

  const marker = await readMarker(sandbox);
  if (marker?.checkpointId === manifest.checkpointId && marker.sha256 === manifest.sha256) {
    return { checkpointId: manifest.checkpointId, restored: false };
  }

  const downloaded = await latestWorkspaceCheckpoint(scope, sessionId);
  if (!downloaded) return { restored: false };
  const { archive } = downloaded;

  await sandbox.writeBinaryFile({ path: ARCHIVE_PATH, content: archive });
  const restore = await sandbox.run({
    command: `mkdir -p /workspace && tar -xzf ${ARCHIVE_PATH} -C /workspace`,
  });
  if (restore.exitCode !== 0) {
    throw new Error(`Could not restore sandbox checkpoint: ${restore.stderr || restore.stdout}`);
  }
  await writeMarker(sandbox, manifest);
  return { checkpointId: manifest.checkpointId, restored: true };
}

export async function checkpointWorkspaceToMongo(
  sandbox: SandboxSession,
  scope: TenantScope,
  sessionId: string,
  reason: string,
): Promise<SandboxManifest> {
  const archiveResult = await sandbox.run({
    command: `tar --exclude='./.eve-hub' -czf ${ARCHIVE_PATH} -C /workspace .`,
  });
  if (archiveResult.exitCode !== 0) {
    throw new Error(`Could not archive sandbox workspace: ${archiveResult.stderr}`);
  }

  const bytes = await sandbox.readBinaryFile({ path: ARCHIVE_PATH });
  if (!bytes) throw new Error("Sandbox archive was not created.");

  const archive = Buffer.from(bytes);
  const manifest = await storeWorkspaceCheckpoint(archive, {
    reason,
    sandboxId: sandbox.id,
    scope,
    sessionId,
  });
  await writeMarker(sandbox, manifest);

  return manifest;
}
