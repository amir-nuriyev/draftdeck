"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, resolveShareLink } from "@/app/lib/api";
import { getAccessToken } from "@/app/lib/auth";
import type { ShareResolveRecord } from "@/app/lib/types";

export default function ShareResolveView({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ShareResolveRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const payload = await resolveShareLink(token);
        if (cancelled) {
          return;
        }
        setResolved(payload);
      } catch (requestError) {
        const message =
          requestError instanceof ApiError
            ? requestError.message
            : "Could not resolve this share link.";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <main className="app-shell min-h-screen p-6">
        <div className="glass-panel mx-auto max-w-3xl rounded-[1.8rem] p-6 text-slate-600">
          Resolving share link...
        </div>
      </main>
    );
  }

  if (error || !resolved) {
    return (
      <main className="app-shell min-h-screen p-6">
        <div className="glass-panel mx-auto max-w-3xl rounded-[1.8rem] p-6">
          <div className="section-kicker">Share link</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Link unavailable</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {error || "This share link is unavailable."}
          </p>
          {error?.toLowerCase().includes("authentication") ? (
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Sign in first, then reopen this URL: <span className="font-mono">/share/{token}</span>
            </p>
          ) : null}
          <div className="mt-5">
            <Link href="/" className="button-ghost rounded-full px-4 py-2 text-sm font-semibold">
              Back to board
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const authenticated = Boolean(getAccessToken());

  return (
    <main className="app-shell min-h-screen p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <section className="glass-panel rounded-[1.8rem] p-6">
          <div className="section-kicker">Share link</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-slate-950">
            {resolved.draft.title}
          </h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">{resolved.draft.brief}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="signal-pill">Access: {resolved.access_mode}</span>
            <span className="signal-pill">Granted role: {resolved.granted_role}</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {authenticated ? (
              <Link
                href={`/drafts/${resolved.draft.id}`}
                className="button-ink inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold"
              >
                Open in editor
              </Link>
            ) : null}
            <Link href="/" className="button-ghost inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold">
              Back to board
            </Link>
          </div>
        </section>

        <section className="glass-panel rounded-[1.8rem] p-6">
          <div className="section-kicker">Read preview</div>
          <article className="mt-3 whitespace-pre-wrap text-sm leading-8 text-slate-700">
            {resolved.draft.plain_content || "No text content available."}
          </article>
        </section>
      </div>
    </main>
  );
}
