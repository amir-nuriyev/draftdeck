"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  ApiError,
  createDraft,
  getHealth,
  getStudioOverview,
  listDrafts,
} from "@/app/lib/api";
import {
  accentOptions,
  accentPreview,
  formatTimestamp,
  getExcerpt,
  readStoredRole,
  stageLabel,
  writeStoredRole,
} from "@/app/lib/ui";
import {
  stageOptions,
  type DraftStage,
  type DraftSummary,
  type HealthResponse,
  type StudioOverview,
  type UserRole,
} from "@/app/lib/types";
import PersonaSwitcher from "./persona-switcher";

type StageFilter = "all" | DraftStage;

function BrandMark() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-[1.4rem] bg-[#181818] text-white shadow-[0_22px_45px_rgba(24,24,24,0.18)]">
      <svg viewBox="0 0 28 28" aria-hidden="true" className="h-7 w-7">
        <path
          d="M7 7.5h14v2H7Zm0 5h14v2H7Zm0 5h9v2H7Z"
          fill="currentColor"
          opacity="0.95"
        />
        <path d="M18.5 17.5 21 20l4-5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className={`rounded-[1.4rem] border p-4 ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export default function WorkspaceBoard() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("owner");
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [overview, setOverview] = useState<StudioOverview | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const deferredSearch = useDeferredValue(search);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [content, setContent] = useState("");
  const [stage, setStage] = useState<DraftStage>("concept");
  const [accent, setAccent] = useState<string>(accentOptions[0].value);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const storedRole = readStoredRole();
    if (storedRole) {
      setRole(storedRole);
    }
  }, []);

  useEffect(() => {
    writeStoredRole(role);
  }, [role]);

  async function loadBoard() {
    setLoading(true);
    setError(null);

    const [draftsResult, overviewResult, healthResult] = await Promise.allSettled([
      listDrafts(),
      getStudioOverview(),
      getHealth(),
    ]);

    if (draftsResult.status === "fulfilled") {
      setDrafts(draftsResult.value);
    } else {
      const message =
        draftsResult.reason instanceof Error
          ? draftsResult.reason.message
          : "Failed to load the draft board.";
      setError(message);
    }

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    }

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
    } else if (draftsResult.status === "fulfilled") {
      setError("Backend health check failed. Start the FastAPI service first.");
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadBoard();
  }, [role]);

  const filteredDrafts = drafts.filter((draft) => {
    const query = deferredSearch.trim().toLowerCase();
    const matchesQuery =
      !query ||
      draft.title.toLowerCase().includes(query) ||
      draft.brief.toLowerCase().includes(query);
    const matchesStage = stageFilter === "all" || draft.stage === stageFilter;
    return matchesQuery && matchesStage;
  });

  async function handleCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Add a draft title before creating it.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const draft = await createDraft({
        title: title.trim(),
        brief,
        content,
        stage,
        accent,
        create_snapshot: true,
      });

      setTitle("");
      setBrief("");
      setContent("");
      setStage("concept");
      setAccent(accentOptions[0].value);
      startTransition(() => {
        router.push(`/drafts/${draft.id}`);
      });
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to create the draft.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell min-h-screen">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="glass-panel overflow-hidden rounded-[2rem] p-6 sm:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),460px]">
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <BrandMark />
                <div className="space-y-3">
                  <div className="section-kicker">Assignment 1 PoC</div>
                  <div>
                    <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
                      DraftDeck keeps collaborative writing visible, staged, and AI-assisted.
                    </h1>
                    <p className="mt-3 max-w-2xl text-base leading-8 text-slate-600">
                      This refactor turns the source project into a writing cockpit: one board for
                      active drafts, one cockpit for editing, and an AI side dock that tracks what
                      changed and why.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <StatCard
                  label="Accessible drafts"
                  value={overview?.accessible_drafts ?? "—"}
                  tone="bg-[rgba(255,255,255,0.62)]"
                />
                <StatCard
                  label="Concept"
                  value={overview?.concept_count ?? "—"}
                  tone="bg-[rgba(255,247,237,0.9)]"
                />
                <StatCard
                  label="Drafting"
                  value={overview?.drafting_count ?? "—"}
                  tone="bg-[rgba(236,253,245,0.9)]"
                />
                <StatCard
                  label="Review"
                  value={overview?.review_count ?? "—"}
                  tone="bg-[rgba(239,246,255,0.9)]"
                />
              </div>
            </div>

            <div className="panel-soft rounded-[1.8rem] border border-[rgba(34,39,46,0.08)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="section-kicker">Session lens</div>
                  <div className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                    Demo personas
                  </div>
                </div>
                <span className="signal-pill">
                  {health ? `Backend ${health.assistant_mode}` : "Connecting"}
                </span>
              </div>

              <div className="mt-4">
                <PersonaSwitcher value={role} onChange={setRole} compact />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="field-shell">
                  <span className="field-label">Search</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Find a draft by title or brief"
                    className="field"
                  />
                </label>
                <label className="field-shell">
                  <span className="field-label">Stage</span>
                  <select
                    value={stageFilter}
                    onChange={(event) => setStageFilter(event.target.value as StageFilter)}
                    className="field-select"
                  >
                    <option value="all">All stages</option>
                    {stageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-5 rounded-[1.3rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.65)] p-4 text-sm leading-7 text-slate-600">
                {overview ? (
                  <>
                    <div className="font-semibold text-slate-900">{overview.active_members} demo members</div>
                    <div className="mt-1">
                      LM Studio mode: {overview.assistant_mode}. Search and stage filters affect the
                      board below in real time.
                    </div>
                  </>
                ) : (
                  "Board metrics load after the backend responds."
                )}
              </div>
            </div>
          </div>
        </header>

        {error ? <div className="notice-card notice-error">{error}</div> : null}

        <section className="grid gap-6 xl:grid-cols-[430px,minmax(0,1fr)]">
          <section className="glass-panel rounded-[2rem] p-6">
            <div className="space-y-2">
              <div className="section-kicker">New draft</div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-slate-950">
                Start from a brief, not a blank page
              </h2>
              <p className="text-sm leading-7 text-slate-600">
                Capture the working brief, seed the first paragraphs, pick a lane, and drop straight
                into the cockpit.
              </p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreateDraft}>
              <label className="field-shell">
                <span className="field-label">Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Quarterly launch narrative"
                  className="field"
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Brief</span>
                <textarea
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  rows={4}
                  placeholder="One-line summary for the board card"
                  className="field-area"
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Starter copy</span>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={9}
                  placeholder="Paste notes, a prompt, or a first paragraph."
                  className="field-area min-h-[13rem]"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field-shell">
                  <span className="field-label">Lane</span>
                  <select
                    value={stage}
                    onChange={(event) => setStage(event.target.value as DraftStage)}
                    className="field-select"
                  >
                    {stageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field-shell">
                  <span className="field-label">Accent</span>
                  <div className="grid grid-cols-4 gap-2">
                    {accentOptions.map((option) => {
                      const active = accent === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAccent(option.value)}
                          className={`accent-swatch ${active ? "ring-2 ring-offset-2 ring-offset-[rgba(247,242,234,0.8)]" : ""}`}
                          style={{ background: option.color }}
                          aria-label={option.label}
                          title={option.label}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="button-ink h-12 w-full rounded-full">
                {submitting ? "Opening cockpit..." : "Create draft"}
              </button>
            </form>
          </section>

          <section className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              {stageOptions.map((option) => {
                const stageDrafts = filteredDrafts.filter((draft) => draft.stage === option.value);
                return (
                  <section key={option.value} className="glass-panel rounded-[1.8rem] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="section-kicker">{option.label}</div>
                        <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                          {stageDrafts.length}
                        </div>
                      </div>
                      <div
                        className="h-12 w-12 rounded-[1rem]"
                        style={{ background: option.badge }}
                        aria-hidden="true"
                      />
                    </div>

                    <div className="mt-4 space-y-3">
                      {loading ? (
                        <div className="board-card text-sm text-slate-500">Loading drafts...</div>
                      ) : stageDrafts.length === 0 ? (
                        <div className="board-card text-sm leading-7 text-slate-500">
                          No drafts match the current filters in this lane.
                        </div>
                      ) : (
                        stageDrafts.map((draft) => (
                          <Link
                            key={draft.id}
                            href={`/drafts/${draft.id}`}
                            className="board-card block rounded-[1.45rem] border border-[rgba(34,39,46,0.08)] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-lg font-semibold tracking-tight text-slate-950">
                                  {draft.title}
                                </div>
                                <div className="mt-1 text-sm text-slate-500">
                                  {draft.owner_name} · {draft.my_role}
                                </div>
                              </div>
                              <span
                                className="h-4 w-4 rounded-full"
                                style={{ background: accentPreview(draft.accent) }}
                                aria-hidden="true"
                              />
                            </div>
                            <p className="mt-3 text-sm leading-7 text-slate-600">
                              {getExcerpt(draft.brief, 120)}
                            </p>
                            <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                              <span>{stageLabel(draft.stage)}</span>
                              <span>{formatTimestamp(draft.updated_at)}</span>
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
