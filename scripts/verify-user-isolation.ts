import {
  createAppSessionToken,
  SESSION_COOKIE,
  type AppUser,
} from "../src/lib/app-auth";

async function main(): Promise<void> {
  const baseUrl = process.env.EVE_VERIFY_BASE_URL ?? "http://127.0.0.1:3100";
  const suffix = crypto.randomUUID();
  const shared = {
    passwordHash: "unused-in-signed-session-test",
    role: "member" as const,
    tenantId: "isolation-verification",
    workspaceId: "shared-workspace",
  };
  const userA: AppUser = {
    ...shared,
    email: "alice@verification.local",
    id: `alice-${suffix}`,
    name: "Alice Verification",
  };
  const userB: AppUser = {
    ...shared,
    email: "bob@verification.local",
    id: `bob-${suffix}`,
    name: "Bob Verification",
  };

  function headers(user: AppUser, json = false): HeadersInit {
    return {
      cookie: `${SESSION_COOKIE}=${createAppSessionToken(user)}`,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  const title = `Private procedure ${suffix}`;
  const create = await fetch(`${baseUrl}/api/hub/task-examples`, {
  body: JSON.stringify({
    goal: "Verify that one user's learned behavior remains private.",
    steps: [{ instruction: "Read only the current owner's procedure." }],
    title,
    triggers: ["isolation verification"],
  }),
  headers: headers(userA, true),
  method: "POST",
  });
  if (create.status !== 201) {
    throw new Error(`Could not create fixture: ${await create.text()}`);
  }

  async function titlesFor(user: AppUser): Promise<readonly string[]> {
    const response = await fetch(`${baseUrl}/api/hub/task-examples`, {
      cache: "no-store",
      headers: headers(user),
    });
    if (!response.ok) throw new Error(`Could not list examples: ${await response.text()}`);
    const body = (await response.json()) as { examples: readonly { title: string }[] };
    return body.examples.map((example) => example.title);
  }

  const aliceTitles = await titlesFor(userA);
  const bobTitles = await titlesFor(userB);
  if (!aliceTitles.includes(title) || bobTitles.includes(title)) {
    throw new Error("Per-user behavior isolation verification failed.");
  }

  console.log(
    JSON.stringify(
      {
        aliceCanReadOwnProcedure: true,
        bobCanReadAliceProcedure: false,
        sharedTenant: userA.tenantId,
        sharedWorkspace: userA.workspaceId,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
