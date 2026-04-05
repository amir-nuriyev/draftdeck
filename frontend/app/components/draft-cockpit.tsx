"use client";

import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  ApiError,
  createSnapshot,
  deleteCollaborator,
  exportDraft,
  getDraft,
  listAssistantRuns,
  listCollaborators,
  listMembers,
  listSnapshots,
  requestSuggestion,
  restoreSnapshot,
  updateAssistantDecision,
  updateDraft,
  upsertCollaborator,
} from "@/app/lib/api";
import { WS_BASE_URL } from "@/app/lib/config";
import {
  accentOptions,
  accentPreview,
  formatTimestamp,
  getDemoIdentityForRole,
  getExcerpt,
  getRoleForDemoUserId,
  readStoredRole,
  stageLabel,
  writeStoredRole,
} from "@/app/lib/ui";
import {
  assistantFeatureOptions,
  canCreateSnapshots,
  canEdit,
  canManageCollaborators,
  canRestoreSnapshots,
  canUseAssistant,
  stageOptions,
  type AssistantFeature,
  type AssistantRun,
  type CollaboratorRecord,
  type DraftRecord,
  type DraftStage,
  type MemberRecord,
  type SnapshotRecord,
  type UserRole,
} from "@/app/lib/types";
import PersonaSwitcher from "./persona-switcher";

type ShareDraft = UserRole | "none";
type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline" | "error";

type PresenceWire = {
  memberId: string | number;
  memberName: string;
  clientId: string;
  cursor?: { from?: number; to?: number } | null;
  selection?: { from?: number; to?: number } | null;
};

type PresenceActor = {
  id: string;
  label: string;
  role: UserRole;
  memberId: number;
  selectionFrom: number | null;
  selectionTo: number | null;
};

type SocketMessage =
  | {
      type: "session:ack";
      roomId: string;
      clientId: string;
      participants: PresenceWire[];
    }
  | {
      type: "presence:sync";
      roomId: string;
      participants: PresenceWire[];
    }
  | {
      type: "draft:patch" | "assistant:status" | "snapshot:restored";
      roomId: string;
      sender: {
        memberId: string | number;
        memberName: string;
        clientId: string;
      };
      payload: Record<string, unknown>;
    }
  | {
      type: "conflict:warning";
      roomId: string;
      message: string;
      range: {
        from: number;
        to: number;
      };
      participants: Array<{
        memberId: string | number;
        memberName: string;
        clientId: string;
      }>;
    }
  | {
      type: "error";
      roomId: string;
      message: string;
    };

function mapPresence(participant: PresenceWire): PresenceActor {
  return {
    id: participant.clientId,
    label: participant.memberName,
    role: getRoleForDemoUserId(participant.memberId),
    memberId: Number(participant.memberId),
    selectionFrom:
      typeof participant.selection?.from === "number" ? participant.selection.from : null,
    selectionTo: typeof participant.selection?.to === "number" ? participant.selection.to : null,
  };
}

function buildShareMap(
  members: MemberRecord[],
  collaborators: CollaboratorRecord[],
): Record<number, ShareDraft> {
  const byMemberId = new Map(collaborators.map((collaborator) => [collaborator.member_id, collaborator.role]));
  return members.reduce<Record<number, ShareDraft>>((accumulator, member) => {
    accumulator[member.id] = member.id === 1 ? "owner" : byMemberId.get(member.id) ?? "none";
    return accumulator;
  }, {});
}

function getSelectionContext(content: string, start: number, end: number) {
  const left = Math.max(0, start - 180);
  const right = Math.min(content.length, end + 180);
  return content.slice(left, right);
}

function buildDownloadFilename(title: string, format: "md" | "txt" | "json") {
  const stem = (title.trim() || "draft")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/^-+|-+$/g, "");
  return `${stem || "draft"}.${format}`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function connectionLabel(status: ConnectionStatus) {
  switch (status) {
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    case "error":
      return "Socket error";
    default:
      return "Connecting";
  }
}

export default function DraftCockpit({ draftId }: { draftId: number }) {
  const [role, setRole] = useState<UserRole>("owner");
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [content, setContent] = useState("");
  const [stage, setStage] = useState<DraftStage>("concept");
  const [accent, setAccent] = useState<string>("ember");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [selectedText, setSelectedText] = useState("");
  const [assistantFeature, setAssistantFeature] = useState<AssistantFeature>("rewrite");
  const [targetLanguage, setTargetLanguage] = useState("Georgian");
  const [assistantResult, setAssistantResult] = useState("");
  const [assistantRunId, setAssistantRunId] = useState<number | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [presence, setPresence] = useState<PresenceActor[]>([]);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([]);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [shareDrafts, setShareDrafts] = useState<Record<number, ShareDraft>>({});
  const [assistantRuns, setAssistantRuns] = useState<AssistantRun[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [sidebarMessage, setSidebarMessage] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"md" | "txt" | "json" | null>(null);
  const [socketNonce, setSocketNonce] = useState(0);

  const clientIdRef = useRef(`client-${Math.random().toString(36).slice(2, 10)}`);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const storedRole = readStoredRole();
    if (storedRole) {
      setRole(storedRole);
    }
  }, []);

  useEffect(() => {
    writeStoredRole(role);
  }, [role]);

  useEffect(() => {
    function handleOffline() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (
        socketRef.current?.readyState === WebSocket.OPEN ||
        socketRef.current?.readyState === WebSocket.CONNECTING
      ) {
        socketRef.current.close();
      }
      setConnectionStatus("offline");
    }

    function handleOnline() {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        return;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      setConnectionStatus("reconnecting");
      setSocketNonce((current) => current + 1);
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  async function refreshSidePanels(currentDraftId: number, currentRole: UserRole = role) {
    const [snapshotsResult, assistantRunsResult, collaboratorsResult, membersResult] =
      await Promise.allSettled([
        listSnapshots(currentDraftId),
        listAssistantRuns({ draft_id: currentDraftId, limit: 12 }),
        listCollaborators(currentDraftId),
        canManageCollaborators(currentRole)
          ? listMembers()
          : Promise.resolve([] as MemberRecord[]),
      ]);

    if (snapshotsResult.status === "fulfilled") {
      setSnapshots(snapshotsResult.value);
    }

    if (assistantRunsResult.status === "fulfilled") {
      setAssistantRuns(assistantRunsResult.value);
    }

    if (collaboratorsResult.status === "fulfilled") {
      setCollaborators(collaboratorsResult.value);
    } else {
      setCollaborators([]);
    }

    if (membersResult.status === "fulfilled") {
      setMembers(membersResult.value);
      setShareDrafts(
        buildShareMap(
          membersResult.value,
          collaboratorsResult.status === "fulfilled" ? collaboratorsResult.value : [],
        ),
      );
    } else {
      setMembers([]);
      setShareDrafts({});
    }
  }

  useEffect(() => {
    if (!Number.isFinite(draftId) || draftId <= 0) {
      setError("Invalid draft id.");
      setLoading(false);
      return;
    }

    async function run() {
      setLoading(true);
      setError(null);
      setAssistantError(null);
      setSidebarError(null);
      setSidebarMessage(null);

      try {
        const currentDraft = await getDraft(draftId);
        setDraft(currentDraft);
        setTitle(currentDraft.title);
        setBrief(currentDraft.brief);
        setContent(currentDraft.content);
        setStage(currentDraft.stage);
        setAccent(currentDraft.accent);
        setDirty(false);
        await refreshSidePanels(draftId, role);
      } catch (requestError) {
        const message =
          requestError instanceof ApiError
            ? requestError.message
            : "Failed to load the draft.";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, role]);

  const handleSocketMessage = useEffectEvent((event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as SocketMessage;

    if (message.type === "session:ack" || message.type === "presence:sync") {
      setPresence(message.participants.map(mapPresence));
      setConnectionStatus("live");
      return;
    }

    if (message.type === "draft:patch") {
      if (dirty) {
        setRemoteNotice(`${message.sender.memberName} changed the draft while you were editing locally.`);
        return;
      }

      const payload = message.payload;
      const nextTitle = typeof payload.title === "string" ? payload.title : title;
      const nextBrief = typeof payload.brief === "string" ? payload.brief : brief;
      const nextContent = typeof payload.content === "string" ? payload.content : content;
      const nextStage =
        payload.stage === "concept" || payload.stage === "drafting" || payload.stage === "review"
          ? payload.stage
          : stage;
      const nextAccent = typeof payload.accent === "string" ? payload.accent : accent;

      setTitle(nextTitle);
      setBrief(nextBrief);
      setContent(nextContent);
      setStage(nextStage);
      setAccent(nextAccent);
      setDraft((current) =>
        current
          ? {
              ...current,
              title: nextTitle,
              brief: nextBrief,
              content: nextContent,
              stage: nextStage,
              accent: nextAccent,
            }
          : current,
      );
      setRemoteNotice(`${message.sender.memberName} pushed a live patch.`);
      return;
    }

    if (message.type === "assistant:status") {
      const feature = typeof message.payload.feature === "string" ? message.payload.feature : "assistant";
      setRemoteNotice(`${message.sender.memberName} is running ${feature} on a selection.`);
      return;
    }

    if (message.type === "conflict:warning") {
      const names = message.participants.map((participant) => participant.memberName).join(" and ");
      setRemoteNotice(
        `${message.message} ${names} overlap around ${message.range.from}-${message.range.to}.`,
      );
      return;
    }

    if (message.type === "snapshot:restored") {
      setRemoteNotice(`${message.sender.memberName} restored a snapshot.`);
      return;
    }

    if (message.type === "error") {
      setConnectionStatus("error");
      setRemoteNotice(message.message);
    }
  });

  useEffect(() => {
    const identity = getDemoIdentityForRole(role);
    let cancelled = false;

    setConnectionStatus("connecting");

    const socket = new WebSocket(
      `${WS_BASE_URL}/drafts/${draftId}?userId=${identity.userId}&userName=${encodeURIComponent(
        identity.userName,
      )}&clientId=${clientIdRef.current}`,
    );

    socketRef.current = socket;
    socket.onmessage = handleSocketMessage;
    socket.onerror = () => {
      if (!cancelled) {
        setConnectionStatus(window.navigator.onLine ? "error" : "offline");
      }
    };
    socket.onclose = () => {
      if (cancelled) {
        return;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      setConnectionStatus(window.navigator.onLine ? "reconnecting" : "offline");
      reconnectTimerRef.current = setTimeout(() => {
        setSocketNonce((current) => current + 1);
      }, 1200);
    };

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      socket.close();
    };
  }, [draftId, role, socketNonce]);

  function sendSocketMessage(payload: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }

  function syncSelection() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    setSelectionStart(start);
    setSelectionEnd(end);
    setSelectedText(editor.value.slice(start, end));
    sendSocketMessage({
      type: "presence:update",
      cursor: { from: end, to: end },
      selection: start === end ? null : { from: start, to: end },
    });
  }

  function pushLivePatch(payload: Record<string, unknown>) {
    sendSocketMessage({
      type: "draft:patch",
      payload,
    });
  }

  function handleContentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const start = event.target.selectionStart ?? 0;
    const end = event.target.selectionEnd ?? start;
    setContent(nextValue);
    setSelectionStart(start);
    setSelectionEnd(end);
    setSelectedText(nextValue.slice(start, end));
    setDirty(true);
    pushLivePatch({
      content: nextValue,
      range: {
        from: start,
        to: Math.max(end, start + 1),
      },
    });
    sendSocketMessage({
      type: "presence:update",
      cursor: { from: end, to: end },
      selection: start === end ? null : { from: start, to: end },
    });
  }

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setTitle(nextValue);
    setDirty(true);
    pushLivePatch({ title: nextValue });
  }

  function handleBriefChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setBrief(nextValue);
    setDirty(true);
    pushLivePatch({ brief: nextValue });
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveMessage(null);
    setError(null);

    try {
      const updated = await updateDraft(draftId, {
        title,
        brief,
        content,
        stage,
        accent,
      });
      setDraft(updated);
      setDirty(false);
      setSaveMessage("Saved to the backend.");
      await refreshSidePanels(draftId);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to save the draft.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAssistantRequest() {
    if (!selectedText.trim()) {
      setAssistantError("Select a passage in the editor before invoking the assistant.");
      return;
    }

    setAssistantBusy(true);
    setAssistantError(null);
    setAssistantResult("");
    setRemoteNotice(null);
    sendSocketMessage({
      type: "assistant:status",
      payload: { feature: assistantFeature, state: "pending" },
    });

    try {
      const response = await requestSuggestion({
        feature: assistantFeature,
        selected_text: selectedText,
        surrounding_context: getSelectionContext(content, selectionStart, selectionEnd),
        target_language: assistantFeature === "translate" ? targetLanguage : undefined,
        draft_id: draftId,
        selection_start: selectionStart,
        selection_end: selectionEnd,
      });
      setAssistantResult(response.suggestion_text);
      setAssistantRunId(response.run_id);
      await refreshSidePanels(draftId);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Assistant request failed.";
      setAssistantError(message);
    } finally {
      setAssistantBusy(false);
    }
  }

  async function applyAssistantResult(mode: "replace" | "note" | "dismiss") {
    if (assistantRunId === null) {
      return;
    }

    try {
      if (mode === "dismiss") {
        await updateAssistantDecision(assistantRunId, {
          decision: "rejected",
        });
        setAssistantResult("");
        setAssistantRunId(null);
        await refreshSidePanels(draftId);
        return;
      }

      const nextContent =
        mode === "replace"
          ? `${content.slice(0, selectionStart)}${assistantResult}${content.slice(selectionEnd)}`
          : `${content}\n\nAI variation\n${assistantResult}`;

      setContent(nextContent);
      setDirty(true);
      pushLivePatch({ content: nextContent });

      await updateAssistantDecision(assistantRunId, {
        decision: mode === "replace" ? "accepted" : "partial",
        applied_excerpt: assistantResult,
      });
      setAssistantResult("");
      setAssistantRunId(null);
      await refreshSidePanels(draftId);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to apply the assistant result.";
      setAssistantError(message);
    }
  }

  async function handleCreateSnapshot() {
    setSidebarMessage(null);
    setSidebarError(null);

    try {
      const snapshot = await createSnapshot(draftId, { label: snapshotLabel || undefined });
      setSnapshots((current) => [snapshot, ...current]);
      setSnapshotLabel("");
      setSidebarMessage("Snapshot stored.");
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to create the snapshot.";
      setSidebarError(message);
    }
  }

  async function handleRestoreSnapshot(snapshotId: number) {
    setSidebarMessage(null);
    setSidebarError(null);

    try {
      const restored = await restoreSnapshot(draftId, snapshotId);
      setDraft(restored);
      setTitle(restored.title);
      setBrief(restored.brief);
      setContent(restored.content);
      setStage(restored.stage);
      setAccent(restored.accent);
      setDirty(false);
      sendSocketMessage({
        type: "snapshot:restored",
        payload: { snapshotId },
      });
      await refreshSidePanels(draftId);
      setSidebarMessage("Snapshot restored.");
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to restore the snapshot.";
      setSidebarError(message);
    }
  }

  async function handleCollaboratorChange(memberId: number, nextRole: ShareDraft) {
    setSidebarMessage(null);
    setSidebarError(null);
    setShareDrafts((current) => ({ ...current, [memberId]: nextRole }));

    try {
      if (nextRole === "none") {
        await deleteCollaborator(draftId, memberId);
      } else {
        await upsertCollaborator(draftId, {
          member_id: memberId,
          role: nextRole,
        });
      }
      await refreshSidePanels(draftId);
      setSidebarMessage("Collaborator access updated.");
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to update collaborator access.";
      setSidebarError(message);
    }
  }

  async function handleExport(format: "md" | "txt" | "json") {
    setExportingFormat(format);
    try {
      const blob = await exportDraft(draftId, format);
      saveBlob(blob, buildDownloadFilename(title, format));
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Export failed.";
      setSidebarError(message);
    } finally {
      setExportingFormat(null);
    }
  }

  if (loading) {
    return (
      <main className="app-shell min-h-screen px-4 py-4 sm:px-6 lg:px-8">
        <div className="glass-panel mx-auto max-w-[1600px] rounded-[2rem] p-8 text-lg text-slate-600">
          Loading DraftDeck cockpit...
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-6">
        <header className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr),480px]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/"
                  className="button-ghost inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold"
                >
                  Back to board
                </Link>
                <span data-testid="connection-status" className="signal-pill">
                  {connectionLabel(connectionStatus)}
                </span>
                <span className="signal-pill">{draft ? stageLabel(draft.stage) : stageLabel(stage)}</span>
                <span className="signal-pill">{draft?.my_role ?? role}</span>
              </div>
              <div>
                <div className="section-kicker">Draft cockpit</div>
                <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-slate-950">
                  {draft?.title || title || "Untitled draft"}
                </h1>
                <p className="mt-2 max-w-3xl text-base leading-8 text-slate-600">
                  {draft ? getExcerpt(draft.brief, 220) : "This draft has not loaded yet."}
                </p>
              </div>
            </div>

            <div className="panel-soft rounded-[1.7rem] border border-[rgba(34,39,46,0.08)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="section-kicker">Perspective</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">Switch demo persona</div>
                </div>
                <div
                  className="h-10 w-10 rounded-[1rem]"
                  style={{ background: accentPreview(accent) }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-4">
                <PersonaSwitcher value={role} onChange={setRole} compact />
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <div data-testid="draft-error" className="notice-card notice-error">
            {error}
          </div>
        ) : null}
        {saveMessage ? (
          <div data-testid="save-message" className="notice-card notice-success">
            {saveMessage}
          </div>
        ) : null}
        {remoteNotice ? (
          <div data-testid="remote-notice" className="notice-card notice-info">
            {remoteNotice}
          </div>
        ) : null}

        <section className="grid gap-6 2xl:grid-cols-[280px,minmax(0,1fr),360px]">
          <aside data-testid="live-room" className="glass-panel rounded-[1.9rem] p-5">
            <div className="section-kicker">Live room</div>
            <div className="mt-3 space-y-3">
              {presence.length === 0 ? (
                <div className="board-card text-sm text-slate-500">No active collaborators yet.</div>
              ) : (
                presence.map((participant) => (
                  <div
                    key={participant.id}
                    data-testid={`presence-card-${participant.memberId}`}
                    className="flex items-center justify-between rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.66)] px-3 py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{participant.label}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        {participant.role}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {participant.selectionFrom !== null && participant.selectionTo !== null
                        ? `${participant.selectionFrom}-${participant.selectionTo}`
                        : "Viewing"}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 space-y-3">
              <div className="section-kicker">Export</div>
              <div className="grid gap-2">
                {(["md", "txt", "json"] as const).map((format) => (
                  <button
                    data-testid={`export-${format}`}
                    key={format}
                    type="button"
                    onClick={() => void handleExport(format)}
                    disabled={exportingFormat !== null}
                    className="button-wash h-11 rounded-full"
                  >
                    {exportingFormat === format ? `Exporting ${format}...` : `Export ${format}`}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),220px,220px]">
              <label className="field-shell">
                <span className="field-label">Title</span>
                <input
                  value={title}
                  onChange={handleTitleChange}
                  disabled={!canEdit(role)}
                  className="field"
                />
              </label>
              <label className="field-shell">
                <span className="field-label">Lane</span>
                <select
                  value={stage}
                  onChange={(event) => {
                    const nextValue = event.target.value as DraftStage;
                    setStage(nextValue);
                    setDirty(true);
                    pushLivePatch({ stage: nextValue });
                  }}
                  disabled={!canEdit(role)}
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
                        onClick={() => {
                          setAccent(option.value);
                          setDirty(true);
                          pushLivePatch({ accent: option.value });
                        }}
                        disabled={!canEdit(role)}
                        className={`accent-swatch ${active ? "ring-2 ring-offset-2 ring-offset-[rgba(247,242,234,0.8)]" : ""}`}
                        style={{ background: option.color }}
                        aria-label={option.label}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="field-shell">
                <span className="field-label">Board brief</span>
                <textarea
                  value={brief}
                  onChange={handleBriefChange}
                  rows={4}
                  disabled={!canEdit(role)}
                  className="field-area"
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Editor</span>
                <textarea
                  ref={editorRef}
                  value={content}
                  onChange={handleContentChange}
                  onSelect={syncSelection}
                  onKeyUp={syncSelection}
                  onMouseUp={syncSelection}
                  rows={22}
                  disabled={!canEdit(role)}
                  className="editor-canvas min-h-[34rem] rounded-[1.6rem] border border-[rgba(34,39,46,0.08)] px-5 py-5 text-[1rem] leading-8 outline-none"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={!canEdit(role) || saving}
                className="button-ink h-12 rounded-full px-6"
              >
                {saving ? "Saving..." : "Save draft"}
              </button>
              <span className="text-sm text-slate-500">
                {dirty ? "Unsaved changes in the editor." : "Editor state matches the backend."}
              </span>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="section-kicker">Assistant dock</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    Operate on the current selection
                  </div>
                </div>
                <span className="signal-pill">{selectedText ? `${selectedText.length} chars` : "No selection"}</span>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="field-shell">
                  <span className="field-label">Feature</span>
                  <select
                    value={assistantFeature}
                    onChange={(event) => setAssistantFeature(event.target.value as AssistantFeature)}
                    className="field-select"
                  >
                    {assistantFeatureOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {assistantFeature === "translate" ? (
                  <label className="field-shell">
                    <span className="field-label">Target language</span>
                    <input
                      value={targetLanguage}
                      onChange={(event) => setTargetLanguage(event.target.value)}
                      className="field"
                    />
                  </label>
                ) : null}

                <div className="rounded-[1.3rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.7)] p-4 text-sm leading-7 text-slate-600">
                  {selectedText ? getExcerpt(selectedText, 180) : "Select a passage to send context into the assistant."}
                </div>

                {assistantError ? (
                  <div data-testid="assistant-error" className="notice-card notice-error">
                    {assistantError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleAssistantRequest()}
                  disabled={!canUseAssistant(role) || assistantBusy}
                  className="button-ink h-12 rounded-full"
                >
                  {assistantBusy ? "Thinking..." : "Generate suggestion"}
                </button>

                {assistantResult ? (
                  <div
                    data-testid="assistant-suggestion"
                    className="space-y-3 rounded-[1.5rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.78)] p-4"
                  >
                    <div className="text-sm font-semibold text-slate-900">Suggestion</div>
                    <textarea
                      value={assistantResult}
                      onChange={(event) => setAssistantResult(event.target.value)}
                      rows={7}
                      className="field-area"
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => void applyAssistantResult("replace")}
                        className="button-ink h-11 rounded-full"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => void applyAssistantResult("note")}
                        className="button-wash h-11 rounded-full"
                      >
                        Add as note
                      </button>
                      <button
                        type="button"
                        onClick={() => void applyAssistantResult("dismiss")}
                        className="button-ghost h-11 rounded-full"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="section-kicker">Snapshots</div>
              <div className="mt-4 grid gap-3">
                <div className="flex gap-2">
                  <input
                    data-testid="snapshot-label-input"
                    value={snapshotLabel}
                    onChange={(event) => setSnapshotLabel(event.target.value)}
                    placeholder="Checkpoint label"
                    className="field"
                  />
                  <button
                    data-testid="snapshot-save-button"
                    type="button"
                    onClick={() => void handleCreateSnapshot()}
                    disabled={!canCreateSnapshots(role)}
                    className="button-wash h-12 rounded-full px-4"
                  >
                    Save
                  </button>
                </div>

                {sidebarMessage ? (
                  <div data-testid="sidebar-message" className="notice-card notice-success">
                    {sidebarMessage}
                  </div>
                ) : null}
                {sidebarError ? (
                  <div data-testid="sidebar-error" className="notice-card notice-error">
                    {sidebarError}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      data-testid={`snapshot-card-${snapshot.id}`}
                      className="rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.66)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {snapshot.label || "Unnamed snapshot"}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                            {formatTimestamp(snapshot.created_at)}
                          </div>
                        </div>
                        {canRestoreSnapshots(role) ? (
                          <button
                            data-testid={`restore-snapshot-${snapshot.id}`}
                            type="button"
                            onClick={() => void handleRestoreSnapshot(snapshot.id)}
                            className="button-ghost rounded-full px-3 py-2 text-xs font-semibold"
                          >
                            Restore
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm leading-7 text-slate-600">
                        {getExcerpt(snapshot.content, 120)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="section-kicker">Team access</div>
              {collaborators.length > 0 ? (
                <div className="mt-2 text-sm text-slate-500">
                  Shared with {collaborators.length} additional collaborator
                  {collaborators.length === 1 ? "" : "s"}.
                </div>
              ) : null}
              <div className="mt-4 space-y-3">
                {draft ? (
                  <div className="rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.66)] p-3">
                    <div className="text-sm font-semibold text-slate-900">{draft.owner_name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">Owner</div>
                  </div>
                ) : null}

                {members.length > 0 ? (
                  members
                    .filter((member) => member.id !== draft?.owner_id)
                    .map((member) => (
                      <div
                        key={member.id}
                        className="rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.66)] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{member.display_name}</div>
                            <div className="text-xs text-slate-500">{member.focus_area}</div>
                          </div>
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ background: member.color_hex }}
                            aria-hidden="true"
                          />
                        </div>
                        <select
                          data-testid={`share-role-${member.id}`}
                          value={shareDrafts[member.id] ?? "none"}
                          onChange={(event) =>
                            void handleCollaboratorChange(member.id, event.target.value as ShareDraft)
                          }
                          disabled={!canManageCollaborators(role)}
                          className="field-select mt-3"
                        >
                          <option value="none">No access</option>
                          <option value="editor">Editor</option>
                          <option value="commenter">Commenter</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </div>
                    ))
                ) : (
                  <div className="text-sm leading-7 text-slate-500">
                    Collaborator controls are only expanded for the owner persona in this PoC.
                  </div>
                )}
              </div>
            </section>

            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="section-kicker">Recent AI runs</div>
              <div className="mt-4 space-y-3">
                {assistantRuns.length === 0 ? (
                  <div className="text-sm leading-7 text-slate-500">No assistant history yet.</div>
                ) : (
                  assistantRuns.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.66)] p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {run.feature} · {run.decision}
                        </div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          {formatTimestamp(run.created_at)}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {run.member_display_name || "Unknown member"}
                      </div>
                      <p className="mt-3 text-sm leading-7 text-slate-600">
                        {getExcerpt(run.result_text, 140)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
