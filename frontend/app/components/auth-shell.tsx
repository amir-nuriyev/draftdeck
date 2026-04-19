"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { ApiError, login, logout, register, whoAmI } from "@/app/lib/api";
import { clearAuthTokens, isAuthenticated } from "@/app/lib/auth";
import type { MemberRecord } from "@/app/lib/types";

const demoCredentials = [
  { label: "Owner demo", login: "maya", password: "owner123" },
  { label: "Editor demo", login: "omar", password: "editor123" },
  { label: "Commenter demo", login: "irene", password: "comment123" },
  { label: "Viewer demo", login: "nika", password: "viewer123" },
];

const roleToDemo: Record<string, { login: string; password: string }> = {
  owner: { login: "maya", password: "owner123" },
  editor: { login: "omar", password: "editor123" },
  commenter: { login: "irene", password: "comment123" },
  viewer: { login: "nika", password: "viewer123" },
};

export default function AuthShell({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<MemberRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loginValue, setLoginValue] = useState("maya");
  const [password, setPassword] = useState("owner123");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function loadCurrentMember() {
    setLoading(true);
    setError(null);
    if (!isAuthenticated()) {
      if (typeof window !== "undefined") {
        const storedRole = window.localStorage.getItem("draftdeck-persona");
        const demo = storedRole ? roleToDemo[storedRole] : undefined;
        if (demo) {
          try {
            await login(demo);
            const current = await whoAmI();
            setMember(current);
            setLoading(false);
            return;
          } catch {
            clearAuthTokens();
          }
        }
      }
      setMember(null);
      setLoading(false);
      return;
    }
    try {
      const current = await whoAmI();
      setMember(current);
    } catch {
      clearAuthTokens();
      setMember(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCurrentMember();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login({ login: loginValue.trim(), password });
      await loadCurrentMember();
    } catch (requestError) {
      const message = requestError instanceof ApiError ? requestError.message : "Login failed.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        display_name: displayName.trim(),
        password,
      });
      await loadCurrentMember();
    } catch (requestError) {
      const message = requestError instanceof ApiError ? requestError.message : "Registration failed.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function handleDemoLogin(loginName: string, loginPassword: string) {
    setPending(true);
    setError(null);
    try {
      await login({ login: loginName, password: loginPassword });
      await loadCurrentMember();
    } catch (requestError) {
      const message = requestError instanceof ApiError ? requestError.message : "Demo login failed.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function handleLogout() {
    setPending(true);
    try {
      await logout();
    } finally {
      setMember(null);
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="app-shell min-h-screen p-6">
        <div className="glass-panel mx-auto max-w-2xl rounded-[1.8rem] p-6 text-slate-600">
          Checking session...
        </div>
      </main>
    );
  }

  if (member) {
    return (
      <>
        <div className="mx-auto mt-4 flex w-full max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="text-sm text-slate-600">
            Signed in as <span className="font-semibold text-slate-900">{member.display_name}</span> ({member.username})
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={pending}
            className="button-ghost rounded-full px-4 py-2 text-sm font-semibold"
          >
            {pending ? "Signing out..." : "Sign out"}
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <main className="app-shell min-h-screen p-6">
      <div className="glass-panel mx-auto max-w-3xl rounded-[2rem] p-6 sm:p-8">
        <div className="section-kicker">DraftDeck Auth</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
          Sign in to start editing
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          Assignment-2 mode uses JWT auth with refresh tokens. You can use demo accounts or register a new user.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "login" ? "button-ink text-white" : "button-ghost"}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "register" ? "button-ink text-white" : "button-ghost"}`}
          >
            Register
          </button>
        </div>

        {mode === "login" ? (
          <form className="mt-5 grid gap-3" onSubmit={handleLogin}>
            <input
              value={loginValue}
              onChange={(event) => setLoginValue(event.target.value)}
              placeholder="Email or username"
              className="field"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Password"
              className="field"
            />
            <button type="submit" disabled={pending} className="button-ink h-11 rounded-full">
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form className="mt-5 grid gap-3" onSubmit={handleRegister}>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="field" />
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" className="field" />
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
              className="field"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Password"
              className="field"
            />
            <button type="submit" disabled={pending} className="button-ink h-11 rounded-full">
              {pending ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}

        {error ? <div className="notice-card notice-error mt-4">{error}</div> : null}

        <div className="mt-6">
          <div className="section-kicker">Quick demo logins</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {demoCredentials.map((credential) => (
              <button
                key={credential.label}
                type="button"
                className="button-wash h-11 rounded-full px-4 text-sm font-semibold"
                onClick={() => void handleDemoLogin(credential.login, credential.password)}
                disabled={pending}
              >
                {credential.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
