import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateAppUser,
  createAppSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/app-auth";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});

export async function POST(request: Request) {
  const body = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  const user = await authenticateAppUser(body.data.email, body.data.password);
  if (!user) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({
    user: { email: user.email, name: user.name, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE, createAppSessionToken(user), sessionCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
