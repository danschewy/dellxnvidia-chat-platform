"use client";

import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";

export function SignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/session", {
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sign-in failed.");
      window.location.reload();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="auth-card">
        <div className="auth-mark"><Sparkles size={24} /></div>
        <p className="eyebrow">Private enterprise intelligence</p>
        <h1>Welcome to Eve</h1>
        <p className="auth-copy">Sign in to your durable workspace on the local GB10.</p>
        <form onSubmit={submit}>
          <label>
            Work email
            <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" minLength={8} name="password" required type="password" />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "Signing in…" : "Enter workspace"}<ArrowRight size={16} />
          </button>
        </form>
        <div className="auth-private"><LockKeyhole size={13} /> Local inference · isolated sessions</div>
      </div>
    </main>
  );
}
