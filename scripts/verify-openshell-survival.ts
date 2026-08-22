import { getCollection } from "../agent/lib/mongo";
import {
  replaceOpenShellSandbox,
  runOpenShellCommand,
} from "../agent/lib/openshell";
import type { TenantScope } from "../agent/lib/tenant";

async function main(): Promise<void> {
  const scope: TenantScope = {
    tenantId: "verification-tenant",
    userId: "verification-user",
    workspaceId: "verification-workspace",
  };
  const sessionId = `survival-${Date.now()}`;
  const marker = `mongo-restored-${crypto.randomUUID()}`;

  const write = await runOpenShellCommand({
  args: ["-lc", `printf '%s' '${marker}' > evidence.txt`],
  executable: "/bin/sh",
  reason: "verification: write evidence",
  scope,
  sessionId,
  timeoutSeconds: 60,
  });
  if (write.exitCode !== 0 || !write.checkpoint?.checkpointId) {
    throw new Error(`Initial sandbox command failed: ${write.stderr}`);
  }

  const replacement = await replaceOpenShellSandbox({
  reason: "verification: prove checkpoint survives sandbox deletion",
  scope,
  sessionId,
  });
  if (replacement.destroyedSandbox === replacement.replacementSandbox) {
    throw new Error("OpenShell replacement reused the destroyed sandbox name.");
  }

  const read = await runOpenShellCommand({
  args: ["evidence.txt"],
  executable: "/bin/cat",
  reason: "verification: read evidence after replacement",
  scope,
  sessionId,
  timeoutSeconds: 60,
  });
  if (read.exitCode !== 0 || read.stdout.trim() !== marker) {
    throw new Error(`Restored evidence mismatch: ${read.stderr || read.stdout}`);
  }

  const manifests = await getCollection("sandbox_manifests");
  const events = await getCollection("openshell_events");
  const manifestCount = await manifests.countDocuments({
  sessionId,
  tenantId: scope.tenantId,
  userId: scope.userId,
  workspaceId: scope.workspaceId,
  });
  const eventTrail = await events
  .find(
    {
      ownerId: scope.userId,
      sessionId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
    { projection: { _id: 0, event: 1, sandboxName: 1 } },
  )
  .sort({ at: 1 })
    .toArray();
  if (manifestCount < 3 || !eventTrail.some((event) => event.event === "restored")) {
    throw new Error("MongoDB did not retain the expected checkpoint/event evidence.");
  }

  console.log(
    JSON.stringify(
      {
        destroyedSandbox: replacement.destroyedSandbox,
        eventTrail,
        manifestCount,
        replacementSandbox: replacement.replacementSandbox,
        restoredEvidence: read.stdout.trim(),
        sessionId,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
