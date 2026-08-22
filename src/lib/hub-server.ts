import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { TenantScope } from "../../agent/lib/tenant";
import {
  appSessionFromRequest,
  SESSION_COOKIE,
  verifyAppSessionToken,
  type AppSession,
} from "./app-auth";

export interface HubIdentity {
  readonly email?: string;
  readonly name: string;
  readonly role: "admin" | "member";
  readonly scope: TenantScope;
}

function localIdentity(): HubIdentity {
  return {
    name: "Local developer",
    role: "admin",
    scope: { tenantId: "local-dev", userId: "local-dev", workspaceId: "eve-hub-dev" },
  };
}

function demoIdentity(): HubIdentity {
  return {
    name: "Hackathon demo",
    role: "admin",
    scope: {
      tenantId: process.env.EVE_DEMO_TENANT_ID ?? "builderbase-demo",
      userId: "demo-user",
      workspaceId: process.env.EVE_DEMO_WORKSPACE_ID ?? "dell-nvidia-hackathon",
    },
  };
}

function identityFromSession(session: AppSession): HubIdentity {
  return {
    email: session.email,
    name: session.name,
    role: session.role,
    scope: {
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: session.workspaceId,
    },
  };
}

export function hubIdentityFromRequest(request: Request): HubIdentity | null {
  if (process.env.NODE_ENV === "development") return localIdentity();
  if (process.env.EVE_DEMO_PUBLIC_ACCESS === "1") return demoIdentity();
  const session = appSessionFromRequest(request);
  return session ? identityFromSession(session) : null;
}

export async function currentHubIdentity(): Promise<HubIdentity | null> {
  if (process.env.NODE_ENV === "development") return localIdentity();
  if (process.env.EVE_DEMO_PUBLIC_ACCESS === "1") return demoIdentity();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = verifyAppSessionToken(token);
  return session ? identityFromSession(session) : null;
}

export function unauthorizedHubResponse(): NextResponse {
  return NextResponse.json({ error: "Sign in to access this workspace." }, { status: 401 });
}
