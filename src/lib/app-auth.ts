import { createHmac, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
export const SESSION_COOKIE = "eve_hub_session";
const SESSION_SECONDS = 8 * 60 * 60;

export interface AppUser {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: "admin" | "member";
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface AppSession {
  readonly email: string;
  readonly expiresAt: number;
  readonly name: string;
  readonly role: "admin" | "member";
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface SessionPayload extends AppSession {
  readonly version: 1;
}

function authSecret(): string {
  const secret = process.env.EVE_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "development") return "eve-hub-development-secret";
  throw new Error("EVE_AUTH_SECRET is required outside development.");
}

function configuredUsers(): readonly AppUser[] {
  const raw = process.env.EVE_USERS_JSON;
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("EVE_USERS_JSON must be a JSON array.");
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`EVE_USERS_JSON[${index}] must be an object.`);
    }
    const user = candidate as Partial<AppUser>;
    const required = [
      "email",
      "id",
      "name",
      "passwordHash",
      "tenantId",
      "workspaceId",
    ] as const;
    for (const field of required) {
      if (typeof user[field] !== "string" || user[field].length === 0) {
        throw new Error(`EVE_USERS_JSON[${index}].${field} is required.`);
      }
    }
    if (user.role !== "admin" && user.role !== "member") {
      throw new Error(`EVE_USERS_JSON[${index}].role must be admin or member.`);
    }
    return user as AppUser;
  });
}

function parsePasswordHash(encoded: string): { hash: Buffer; salt: Buffer } | null {
  const [scheme, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return null;
  try {
    return { hash: Buffer.from(hash, "base64url"), salt: Buffer.from(salt, "base64url") };
  } catch {
    return null;
  }
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed || parsed.hash.byteLength !== 64) return false;
  const candidate = (await scrypt(password, parsed.salt, 64)) as Buffer;
  return timingSafeEqual(candidate, parsed.hash);
}

export async function authenticateAppUser(
  email: string,
  password: string,
): Promise<AppUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = configuredUsers().find(
    (candidate) => candidate.email.trim().toLowerCase() === normalizedEmail,
  );
  if (!user || !(await passwordMatches(password, user.passwordHash))) return null;
  return user;
}

function signature(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

export function createAppSessionToken(user: AppUser): string {
  const payload: SessionPayload = {
    email: user.email,
    expiresAt: Math.floor(Date.now() / 1_000) + SESSION_SECONDS,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    userId: user.id,
    version: 1,
    workspaceId: user.workspaceId,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyAppSessionToken(token: string | undefined): AppSession | null {
  if (!token) return null;
  const [encoded, suppliedSignature] = token.split(".");
  if (!encoded || !suppliedSignature) return null;
  const expected = Buffer.from(signature(encoded));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as
      | SessionPayload
      | undefined;
    if (
      payload?.version !== 1 ||
      payload.expiresAt <= Math.floor(Date.now() / 1_000) ||
      typeof payload.userId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.workspaceId !== "string" ||
      (payload.role !== "admin" && payload.role !== "member")
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function appSessionFromRequest(request: Request): AppSession | null {
  return verifyAppSessionToken(cookieValue(request, SESSION_COOKIE));
}

export function sessionCookieOptions(): {
  readonly httpOnly: true;
  readonly maxAge: number;
  readonly path: "/";
  readonly sameSite: "strict";
  readonly secure: boolean;
} {
  return {
    httpOnly: true,
    maxAge: SESSION_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: process.env.EVE_COOKIE_SECURE === "1",
  };
}
