import type { SessionContext } from "eve/context";

export interface TenantScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface AuthLike {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly principalId: string;
  readonly principalType: string;
}

export function tenantScopeFromAuth(auth: AuthLike | null | undefined): TenantScope {
  const attributes = auth?.attributes;
  const tenantId = attributes?.tenantId;
  const workspaceId = attributes?.workspaceId;

  if (auth?.principalId === "local-dev") {
    return {
      tenantId: "local-dev",
      userId: auth.principalId,
      workspaceId: "eve-hub-dev",
    };
  }

  if (
    auth?.principalType !== "user" ||
    typeof tenantId !== "string" ||
    typeof workspaceId !== "string"
  ) {
    throw new Error("An authenticated workspace user is required.");
  }

  return { tenantId, userId: auth.principalId, workspaceId };
}

export function requireTenantScope(ctx: SessionContext): TenantScope {
  return tenantScopeFromAuth(ctx.session.auth.current);
}
