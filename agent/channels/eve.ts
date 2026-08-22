import { eveChannel } from "eve/channels/eve";
import {
  localDev,
  type AuthFn,
  withAuthChallenges,
} from "eve/channels/auth";
import { appSessionFromRequest } from "../../src/lib/app-auth";

const demoAccess: AuthFn<Request> = withAuthChallenges(
  async () => {
    if (process.env.EVE_DEMO_PUBLIC_ACCESS !== "1") return null;

    return {
      attributes: {
        mode: "hackathon-demo",
        role: "admin",
        tenantId: process.env.EVE_DEMO_TENANT_ID ?? "builderbase-demo",
        workspaceId: process.env.EVE_DEMO_WORKSPACE_ID ?? "dell-nvidia-hackathon",
      },
      authenticator: "eve-hub-demo",
      principalId: "demo-user",
      principalType: "user",
    };
  },
  [{ scheme: "Bearer" }],
);

const appSession: AuthFn<Request> = withAuthChallenges(
  async (request) => {
    const session = appSessionFromRequest(request);
    if (!session) return null;
    return {
      attributes: {
        email: session.email,
        name: session.name,
        role: session.role,
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
      },
      authenticator: "eve-hub-session",
      principalId: session.userId,
      principalType: "user",
    };
  },
  [{ scheme: "Bearer" }],
);

const allowedOrigin = process.env.EVE_ALLOWED_ORIGIN;

export default eveChannel({
  auth: [demoAccess, appSession, localDev()],
  cors: allowedOrigin
    ? {
        allowedHeaders: ["authorization", "content-type"],
        methods: ["GET", "POST"],
        origin: allowedOrigin,
      }
    : undefined,
});
