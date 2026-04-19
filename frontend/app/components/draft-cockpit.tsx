"use client";

import Link from "next/link";
import * as Y from "yjs";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";

import AssistantDiffPreview from "@/app/components/assistant-diff-preview";
import AutosaveIndicator from "@/app/components/autosave-indicator";
import {
  ApiError,
  cancelAssistantRun,
  createShareLink,
  createSnapshot,
  deleteCollaborator,
  exportDraft,
  getDraft,
  listAssistantRuns,
  listCollaborators,
  listMembers,
  listShareLinks,
  listSnapshots,
  revokeShareLink,
  restoreSnapshot,
  streamSuggestion,
  updateAssistantDecision,
  updateDraft,
  upsertCollaborator,
} from "@/app/lib/api";
import {
  buildDiffSegments,
  composeFromSegmentSelection,
  defaultSegmentSelection,
} from "@/app/lib/assistant-diff";
import { getAccessToken } from "@/app/lib/auth";
import { WS_BASE_URL } from "@/app/lib/config";
import {
  accentOptions,
  accentPreview,
  formatTimestamp,
  getExcerpt,
  stageLabel,
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

type ShareDraft = UserRole | "none";
type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline" | "error";
type SaveStatus = "saving" | "saved" | "offline" | "error";

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
  color: string;
  selectionFrom: number | null;
  selectionTo: number | null;
};

type SocketMessage =
  | {
      type: "session:ack";
      roomId: string;
      clientId: string;
      participants: PresenceWire[];
      role?: UserRole;
    }
  | {
      type: "presence:sync";
      roomId: string;
      participants: PresenceWire[];
    }
  | {
      type: "yjs:bootstrap";
      roomId: string;
      updates: Array<{ update: string }>;
    }
  | {
      type: "yjs:update" | "draft:patch" | "assistant:status" | "snapshot:restored";
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

type UndoEntry = {
  html: string;
};

const FALLBACK_COLORS = [
  "#d97706",
  "#0f766e",
  "#2563eb",
  "#9333ea",
  "#b45309",
  "#0e7490",
];

function colorForMember(memberId: number) {
  const index = Math.abs(memberId) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[index];
}

function mapPresence(
  participant: PresenceWire,
  roleLookup: Record<number, UserRole>,
  colorLookup: Record<number, string>,
): PresenceActor {
  const memberId = Number(participant.memberId);
  return {
    id: participant.clientId,
    label: participant.memberName,
    role: roleLookup[memberId] ?? "viewer",
    memberId,
    color: colorLookup[memberId] ?? colorForMember(memberId),
    selectionFrom:
      typeof participant.selection?.from === "number" ? participant.selection.from : null,
    selectionTo:
      typeof participant.selection?.to === "number" ? participant.selection.to : null,
  };
}

function buildShareMap(
  members: MemberRecord[],
  collaborators: CollaboratorRecord[],
  ownerId: number | undefined,
): Record<number, ShareDraft> {
  const byMemberId = new Map(collaborators.map((collaborator) => [collaborator.member_id, collaborator.role]));
  return members.reduce<Record<number, ShareDraft>>((accumulator, member) => {
    accumulator[member.id] = member.id === ownerId ? "owner" : byMemberId.get(member.id) ?? "none";
    return accumulator;
  }, {});
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

function encodeUint8Array(value: Uint8Array) {
  let binary = "";
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return window.btoa(binary);
}

function decodeUint8Array(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeEditorHtml(html: string) {
  return html.trim() || "<p></p>";
}

function buildRoleLookup(
  draft: DraftRecord | null,
  collaborators: CollaboratorRecord[],
): Record<number, UserRole> {
  const roleLookup: Record<number, UserRole> = {};
  if (draft) {
    roleLookup[draft.owner_id] = "owner";
  }
  for (const collaborator of collaborators) {
    roleLookup[collaborator.member_id] = collaborator.role;
  }
  return roleLookup;
}

function buildColorLookup(
  draft: DraftRecord | null,
  members: MemberRecord[],
  collaborators: CollaboratorRecord[],
) {
  const lookup: Record<number, string> = {};
  for (const member of members) {
    lookup[member.id] = member.color_hex;
  }
  if (draft) {
    lookup[draft.owner_id] = lookup[draft.owner_id] ?? colorForMember(draft.owner_id);
  }
  for (const collaborator of collaborators) {
    lookup[collaborator.member_id] =
      lookup[collaborator.member_id] ?? collaborator.color_hex ?? colorForMember(collaborator.member_id);
  }
  return lookup;
}

export default function DraftCockpit({ draftId }: { draftId: number }) {
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [stage, setStage] = useState<DraftStage>("concept");
  const [accent, setAccent] = useState<string>("ember");
  const [contentHtml, setContentHtml] = useState("<p></p>");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [selectedText, setSelectedText] = useState("");
  const [assistantFeature, setAssistantFeature] = useState<AssistantFeature>("rewrite");
  const [targetLanguage, setTargetLanguage] = useState("Georgian");
  const [assistantTone, setAssistantTone] = useState("professional");
  const [assistantLength, setAssistantLength] = useState("concise");
  const [customPrompt, setCustomPrompt] = useState("");
  const [assistantOriginal, setAssistantOriginal] = useState("");
  const [assistantResult, setAssistantResult] = useState("");
  const [assistantRunId, setAssistantRunId] = useState<number | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantSelectionRange, setAssistantSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [segmentSelection, setSegmentSelection] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [presenceRaw, setPresenceRaw] = useState<PresenceWire[]>([]);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([]);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [shareDrafts, setShareDrafts] = useState<Record<number, ShareDraft>>({});
  const [assistantRuns, setAssistantRuns] = useState<AssistantRun[]>([]);
  const [shareLinks, setShareLinks] = useState<Array<{
    id: number;
    role: UserRole;
    access_mode: "authenticated" | "public";
    token: string;
    revoked_at: string | null;
    expires_at: string | null;
  }>>([]);
  const [newShareRole, setNewShareRole] = useState<UserRole>("viewer");
  const [newShareMode, setNewShareMode] = useState<"authenticated" | "public">("authenticated");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [sidebarMessage, setSidebarMessage] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"md" | "txt" | "json" | null>(null);
  const [socketNonce, setSocketNonce] = useState(0);

  const clientIdRef = useRef(`client-${Math.random().toString(36).slice(2, 10)}`);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const initialContentRef = useRef<string>("<p></p>");
  const pendingYjsUpdatesRef = useRef<string[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const lastYUpdateOriginRef = useRef<unknown>(null);
  const loadedOfflineRef = useRef(false);

  const ydocRef = useRef<Y.Doc>(new Y.Doc());

  const role: UserRole = draft?.my_role ?? "viewer";
  const roleLookup = useMemo(() => buildRoleLookup(draft, collaborators), [draft, collaborators]);
  const colorLookup = useMemo(
    () => buildColorLookup(draft, members, collaborators),
    [draft, members, collaborators],
  );

  const presence = useMemo(
    () => presenceRaw.map((participant) => mapPresence(participant, roleLookup, colorLookup)),
    [colorLookup, presenceRaw, roleLookup],
  );

  const diffSegments = useMemo(
    () => buildDiffSegments(assistantOriginal, assistantResult),
    [assistantOriginal, assistantResult],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({ placeholder: "Write collaboratively. Use headings, lists, and code blocks." }),
      Collaboration.configure({ document: ydocRef.current }),
    ],
    editable: canEdit(role),
    onUpdate: ({ editor: nextEditor }) => {
      const nextHtml = normalizeEditorHtml(nextEditor.getHTML());
      setContentHtml(nextHtml);

      if (lastYUpdateOriginRef.current !== "remote") {
        setDirty(true);
        setSaveStatus(window.navigator.onLine ? "saving" : "offline");
      }
      lastYUpdateOriginRef.current = null;
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      const selection = nextEditor.state.selection;
      const from = selection.from;
      const to = selection.to;
      const selected = from === to ? "" : nextEditor.state.doc.textBetween(from, to, " ");

      setSelectedText(selected);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "presence:update",
            cursor: { from: to, to },
            selection: from === to ? null : { from, to },
          }),
        );
      }
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(canEdit(role));
  }, [editor, role]);

  useEffect(() => {
    const ydoc = ydocRef.current;

    const onYDocUpdate = (update: Uint8Array, origin: unknown) => {
      lastYUpdateOriginRef.current = origin;
      if (origin === "remote") {
        return;
      }
      const encoded = encodeUint8Array(update);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "yjs:update", payload: { update: encoded } }));
      } else {
        pendingYjsUpdatesRef.current.push(encoded);
      }
    };

    ydoc.on("update", onYDocUpdate);

    return () => {
      ydoc.off("update", onYDocUpdate);
      ydoc.destroy();
    };
  }, []);

  function queueOfflineDraft(nextHtml: string) {
    const key = `draftdeck-offline-${draftId}`;
    const payload = {
      title,
      brief,
      stage,
      accent,
      content: nextHtml,
      updated_at: Date.now(),
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  }

  function clearOfflineDraft() {
    const key = `draftdeck-offline-${draftId}`;
    window.localStorage.removeItem(key);
  }

  async function refreshSidePanels(
    currentDraftId: number,
    ownerId: number | undefined = draft?.owner_id,
    currentRole: UserRole = role,
  ) {
    const [snapshotsResult, assistantRunsResult, collaboratorsResult, membersResult, shareLinksResult] =
      await Promise.allSettled([
        listSnapshots(currentDraftId),
        listAssistantRuns({ draft_id: currentDraftId, limit: 20 }),
        listCollaborators(currentDraftId),
        canManageCollaborators(currentRole) ? listMembers() : Promise.resolve([] as MemberRecord[]),
        canManageCollaborators(currentRole) ? listShareLinks(currentDraftId) : Promise.resolve([]),
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
          ownerId,
        ),
      );
    } else {
      setMembers([]);
      setShareDrafts({});
    }

    if (shareLinksResult.status === "fulfilled") {
      setShareLinks(shareLinksResult.value);
    } else {
      setShareLinks([]);
    }
  }

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = normalizeEditorHtml(initialContentRef.current || "<p></p>");
    editor.commands.setContent(nextContent, { emitUpdate: false });
    setContentHtml(nextContent);

    const text = editor.state.doc.textBetween(1, editor.state.doc.content.size, " ");
    setSelectedText("");
    if (!text.trim()) {
      editor.commands.focus("end");
    }
  }, [editor, draftId]);

  useEffect(() => {
    if (!Number.isFinite(draftId) || draftId <= 0) {
      setError("Invalid draft id.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setAssistantError(null);
      setSidebarError(null);
      setSidebarMessage(null);

      try {
        const currentDraft = await getDraft(draftId);
        if (cancelled) {
          return;
        }

        setDraft(currentDraft);
        setTitle(currentDraft.title);
        setBrief(currentDraft.brief);
        setStage(currentDraft.stage);
        setAccent(currentDraft.accent);
        initialContentRef.current = normalizeEditorHtml(currentDraft.content);
        setDirty(false);
        setSaveStatus("saved");

        if (!loadedOfflineRef.current && typeof window !== "undefined") {
          const key = `draftdeck-offline-${draftId}`;
          const raw = window.localStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as {
                title?: string;
                brief?: string;
                stage?: DraftStage;
                accent?: string;
                content?: string;
              };
              if (parsed.content && normalizeEditorHtml(parsed.content) !== normalizeEditorHtml(currentDraft.content)) {
                setTitle(parsed.title ?? currentDraft.title);
                setBrief(parsed.brief ?? currentDraft.brief);
                setStage(parsed.stage ?? currentDraft.stage);
                setAccent(parsed.accent ?? currentDraft.accent);
                initialContentRef.current = normalizeEditorHtml(parsed.content);
                setDirty(true);
                setSaveStatus(window.navigator.onLine ? "saving" : "offline");
              }
            } catch {
              window.localStorage.removeItem(key);
            }
          }
          loadedOfflineRef.current = true;
        }

        await refreshSidePanels(draftId, currentDraft.owner_id, currentDraft.my_role);
      } catch (requestError) {
        const message =
          requestError instanceof ApiError
            ? requestError.message
            : "Failed to load the draft.";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  async function saveDraftNow() {
    if (!canEdit(role) || !window.navigator.onLine) {
      if (!window.navigator.onLine) {
        setSaveStatus("offline");
      }
      return;
    }

    try {
      setSaveStatus("saving");
      setSaveMessage(null);
      setError(null);
      const outgoingHtml = normalizeEditorHtml(editor?.getHTML() ?? contentHtml);
      const updated = await updateDraft(draftId, {
        title,
        brief,
        content: outgoingHtml,
        stage,
        accent,
      });
      setDraft(updated);
      setDirty(false);
      setSaveStatus("saved");
      setSaveMessage("Saved to the backend.");
      clearOfflineDraft();
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to save the draft.";
      setError(message);
      setSaveStatus(window.navigator.onLine ? "error" : "offline");
      queueOfflineDraft(normalizeEditorHtml(editor?.getHTML() ?? contentHtml));
    }
  }

  useEffect(() => {
    if (!dirty || !canEdit(role)) {
      return;
    }
    if (!window.navigator.onLine) {
      setSaveStatus("offline");
      queueOfflineDraft(normalizeEditorHtml(editor?.getHTML() ?? contentHtml));
      return;
    }

    const timer = setTimeout(() => {
      void saveDraftNow();
    }, 900);

    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, brief, stage, accent, contentHtml, role]);

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
      setSaveStatus("offline");
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
      if (dirty && canEdit(role)) {
        setSaveStatus("saving");
      }
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [dirty, role]);

  function flushRealtimeQueues() {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const encoded of pendingYjsUpdatesRef.current) {
      socketRef.current.send(JSON.stringify({ type: "yjs:update", payload: { update: encoded } }));
    }
    pendingYjsUpdatesRef.current = [];
  }

  const handleSocketMessage = useEffectEvent((event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as SocketMessage;

    if (message.type === "session:ack" || message.type === "presence:sync") {
      setPresenceRaw(message.participants);
      setConnectionStatus("live");
      flushRealtimeQueues();
      return;
    }

    if (message.type === "yjs:bootstrap") {
      for (const updatePayload of message.updates) {
        if (!updatePayload.update) {
          continue;
        }
        try {
          Y.applyUpdate(ydocRef.current, decodeUint8Array(updatePayload.update), "remote");
        } catch {
          // Ignore malformed remote payloads.
        }
      }
      return;
    }

    if (message.type === "yjs:update") {
      const encoded = message.payload.update;
      if (typeof encoded === "string" && encoded) {
        try {
          Y.applyUpdate(ydocRef.current, decodeUint8Array(encoded), "remote");
        } catch {
          // Ignore malformed update payloads.
        }
      }
      return;
    }

    if (message.type === "draft:patch") {
      const payload = message.payload;
      const nextTitle = typeof payload.title === "string" ? payload.title : title;
      const nextBrief = typeof payload.brief === "string" ? payload.brief : brief;
      const nextStage =
        payload.stage === "concept" || payload.stage === "drafting" || payload.stage === "review"
          ? payload.stage
          : stage;
      const nextAccent = typeof payload.accent === "string" ? payload.accent : accent;

      setTitle(nextTitle);
      setBrief(nextBrief);
      setStage(nextStage);
      setAccent(nextAccent);
      setDraft((current) =>
        current
          ? {
              ...current,
              title: nextTitle,
              brief: nextBrief,
              stage: nextStage,
              accent: nextAccent,
            }
          : current,
      );
      setRemoteNotice(`${message.sender.memberName} updated draft metadata.`);
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
    const token = getAccessToken();
    if (!token) {
      setConnectionStatus("error");
      setRemoteNotice("Missing auth token for realtime connection.");
      return;
    }
    let cancelled = false;

    setConnectionStatus("connecting");

    const socket = new WebSocket(
      `${WS_BASE_URL}/drafts/${draftId}?token=${encodeURIComponent(token)}&clientId=${clientIdRef.current}`,
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
  }, [draftId, socketNonce]);

  useEffect(() => {
    if (!assistantResult) {
      setSegmentSelection({});
      return;
    }
    setSegmentSelection(defaultSegmentSelection(diffSegments));
  }, [assistantResult, diffSegments]);

  function sendSocketMessage(payload: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setTitle(nextValue);
    setDirty(true);
    setSaveStatus(window.navigator.onLine ? "saving" : "offline");
    sendSocketMessage({
      type: "draft:patch",
      payload: { title: nextValue },
    });
  }

  function handleBriefChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setBrief(nextValue);
    setDirty(true);
    setSaveStatus(window.navigator.onLine ? "saving" : "offline");
    sendSocketMessage({
      type: "draft:patch",
      payload: { brief: nextValue },
    });
  }

  async function handleAssistantRequest() {
    if (!editor) {
      return;
    }
    const selection = editor.state.selection;
    let from = selection.from;
    let to = selection.to;
    let selected = from === to ? "" : editor.state.doc.textBetween(from, to, " ").trim();

    if (!selected) {
      from = 1;
      to = Math.max(1, editor.state.doc.content.size);
      selected = editor.state.doc.textBetween(from, to, " ").trim();
      if (!selected) {
        setAssistantError("Add some text to the editor before invoking the assistant.");
        return;
      }
    }

    const left = Math.max(1, from - 280);
    const right = Math.min(editor.state.doc.content.size, to + 280);
    const context = editor.state.doc.textBetween(left, right, " ");

    setAssistantBusy(true);
    setAssistantError(null);
    setAssistantResult("");
    setAssistantOriginal(selected);
    setAssistantSelectionRange({ from, to });
    setRemoteNotice(null);

    sendSocketMessage({
      type: "assistant:status",
      payload: { feature: assistantFeature, state: "pending" },
    });

    try {
      const abortController = new AbortController();
      assistantAbortRef.current = abortController;
      await streamSuggestion(
        {
          feature: assistantFeature,
          selected_text: selected,
          surrounding_context: context,
          target_language: assistantFeature === "translate" ? targetLanguage : undefined,
          draft_id: draftId,
          selection_start: from,
          selection_end: to,
          tone: assistantTone,
          output_length: assistantLength,
          custom_prompt: assistantFeature === "custom" ? customPrompt : undefined,
        },
        {
          signal: abortController.signal,
          onStart: (payload) => {
            setAssistantRunId(payload.run_id);
            setAssistantResult("");
          },
          onChunk: (chunk) => {
            setAssistantResult((current) => current + chunk);
          },
          onDone: () => {
            setAssistantBusy(false);
          },
          onCanceled: () => {
            setAssistantBusy(false);
            setAssistantError("Generation canceled.");
          },
          onError: (message) => {
            setAssistantBusy(false);
            setAssistantError(message);
          },
        },
      );
      await refreshSidePanels(draftId);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Assistant request failed.";
      setAssistantError(message);
    } finally {
      setAssistantBusy(false);
      assistantAbortRef.current = null;
    }
  }

  async function handleCancelAssistant() {
    assistantAbortRef.current?.abort();
    if (assistantRunId !== null) {
      await cancelAssistantRun(assistantRunId).catch(() => undefined);
    }
    setAssistantBusy(false);
  }

  function applyHtmlPatchAtSelection(replacement: string) {
    if (!editor || !assistantSelectionRange) {
      return;
    }
    const { from, to } = assistantSelectionRange;
    undoStackRef.current.push({ html: normalizeEditorHtml(editor.getHTML()) });
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .insertContent(replacement)
      .run();
    setContentHtml(normalizeEditorHtml(editor.getHTML()));
    setDirty(true);
    setSaveStatus(window.navigator.onLine ? "saving" : "offline");
  }

  async function applyAssistantResult(mode: "accept-all" | "partial" | "note" | "dismiss") {
    if (assistantRunId === null) {
      return;
    }

    try {
      if (mode === "dismiss") {
        await updateAssistantDecision(assistantRunId, {
          decision: "rejected",
        });
        setAssistantResult("");
        setAssistantOriginal("");
        setAssistantRunId(null);
        setAssistantSelectionRange(null);
        await refreshSidePanels(draftId);
        return;
      }

      let appliedText = assistantResult;
      if (mode === "partial") {
        appliedText = composeFromSegmentSelection(diffSegments, segmentSelection);
      }

      if (mode === "note") {
        const note = `<p><strong>AI Variation</strong></p><p>${appliedText}</p>`;
        undoStackRef.current.push({ html: normalizeEditorHtml(editor?.getHTML() ?? contentHtml) });
        editor?.chain().focus("end").insertContent(note).run();
        setContentHtml(normalizeEditorHtml(editor?.getHTML() ?? contentHtml));
      } else {
        applyHtmlPatchAtSelection(appliedText);
      }

      const decision =
        mode === "accept-all"
          ? "accepted"
          : mode === "note"
            ? "partial"
            : appliedText === assistantResult
              ? "accepted"
              : appliedText === assistantOriginal
                ? "rejected"
                : "partial";

      await updateAssistantDecision(assistantRunId, {
        decision,
        applied_excerpt: appliedText,
      });
      setAssistantResult("");
      setAssistantOriginal("");
      setAssistantRunId(null);
      setAssistantSelectionRange(null);
      setSegmentSelection({});
      await refreshSidePanels(draftId);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to apply the assistant result.";
      setAssistantError(message);
    }
  }

  function undoLastAssistantApply() {
    const previous = undoStackRef.current.pop();
    if (!previous || !editor) {
      return;
    }
    editor.commands.setContent(previous.html, { emitUpdate: false });
    setContentHtml(normalizeEditorHtml(editor.getHTML()));
    setDirty(true);
    setSaveStatus(window.navigator.onLine ? "saving" : "offline");
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
      setStage(restored.stage);
      setAccent(restored.accent);
      initialContentRef.current = normalizeEditorHtml(restored.content);
      editor?.commands.setContent(initialContentRef.current, { emitUpdate: false });
      setContentHtml(initialContentRef.current);
      setDirty(false);
      setSaveStatus("saved");
      sendSocketMessage({
        type: "snapshot:restored",
        payload: { snapshotId },
      });
      await refreshSidePanels(draftId, restored.owner_id, restored.my_role);
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

  async function handleCreateShareLink() {
    if (!canManageCollaborators(role)) {
      return;
    }
    setSidebarError(null);
    try {
      const link = await createShareLink(draftId, {
        role: newShareRole,
        access_mode: newShareMode,
        expires_at: null,
      });
      setShareLinks((current) => [link, ...current]);
      setSidebarMessage("Share link created.");
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to create share link.";
      setSidebarError(message);
    }
  }

  async function handleRevokeShareLink(linkId: number) {
    if (!canManageCollaborators(role)) {
      return;
    }
    setSidebarError(null);
    try {
      await revokeShareLink(draftId, linkId);
      setShareLinks((current) => current.filter((link) => link.id !== linkId));
      setSidebarMessage("Share link revoked.");
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Failed to revoke share link.";
      setSidebarError(message);
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
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr),520px]">
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
                <AutosaveIndicator status={saveStatus} dirty={dirty} />
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
                  <div className="section-kicker">Session</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    Authenticated collaborator view
                  </div>
                </div>
                <div
                  className="h-10 w-10 rounded-[1rem]"
                  style={{ background: accentPreview(accent) }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-4 rounded-[1rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.6)] p-3 text-sm text-slate-600">
                Rich-text editing uses Tiptap + Yjs collaboration. Token-authenticated WebSocket traffic
                enforces role permissions server-side.
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

        <section className="grid gap-6 2xl:grid-cols-[280px,minmax(0,1fr),420px]">
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
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-3 w-3 rounded-full"
                        style={{ background: participant.color }}
                        aria-hidden="true"
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{participant.label}</div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          {participant.role}
                        </div>
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
                    setSaveStatus(window.navigator.onLine ? "saving" : "offline");
                    sendSocketMessage({ type: "draft:patch", payload: { stage: nextValue } });
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
                          setSaveStatus(window.navigator.onLine ? "saving" : "offline");
                          sendSocketMessage({ type: "draft:patch", payload: { accent: option.value } });
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

              <div className="field-shell">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="field-label">Editor</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                      disabled={!canEdit(role)}
                      className="button-ghost rounded-full px-3 py-1 text-xs"
                    >
                      H2
                    </button>
                    <button
                      type="button"
                      onClick={() => editor?.chain().focus().toggleBold().run()}
                      disabled={!canEdit(role)}
                      className="button-ghost rounded-full px-3 py-1 text-xs"
                    >
                      Bold
                    </button>
                    <button
                      type="button"
                      onClick={() => editor?.chain().focus().toggleItalic().run()}
                      disabled={!canEdit(role)}
                      className="button-ghost rounded-full px-3 py-1 text-xs"
                    >
                      Italic
                    </button>
                    <button
                      type="button"
                      onClick={() => editor?.chain().focus().toggleBulletList().run()}
                      disabled={!canEdit(role)}
                      className="button-ghost rounded-full px-3 py-1 text-xs"
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
                      disabled={!canEdit(role)}
                      className="button-ghost rounded-full px-3 py-1 text-xs"
                    >
                      Code
                    </button>
                  </div>
                </div>
                <EditorContent
                  editor={editor}
                  data-testid="rich-editor"
                  aria-label="Editor"
                  className="editor-canvas tiptap-editor min-h-[34rem] rounded-[1.6rem] border border-[rgba(34,39,46,0.08)] px-5 py-5 text-[1rem] leading-8 outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveDraftNow()}
                disabled={!canEdit(role) || saveStatus === "saving"}
                className="button-ink h-12 rounded-full px-6"
              >
                {saveStatus === "saving" ? "Saving..." : "Save draft"}
              </button>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="section-kicker">Assistant dock</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    Compare before applying
                  </div>
                </div>
                <span className="signal-pill">
                  {selectedText ? `${selectedText.length} chars` : "No selection"}
                </span>
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
                {assistantFeature === "custom" ? (
                  <label className="field-shell">
                    <span className="field-label">Custom prompt</span>
                    <textarea
                      value={customPrompt}
                      onChange={(event) => setCustomPrompt(event.target.value)}
                      rows={3}
                      className="field-area"
                    />
                  </label>
                ) : null}
                {assistantFeature !== "translate" && assistantFeature !== "custom" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="field-shell">
                      <span className="field-label">Tone</span>
                      <input
                        value={assistantTone}
                        onChange={(event) => setAssistantTone(event.target.value)}
                        className="field"
                      />
                    </label>
                    <label className="field-shell">
                      <span className="field-label">Length</span>
                      <input
                        value={assistantLength}
                        onChange={(event) => setAssistantLength(event.target.value)}
                        className="field"
                      />
                    </label>
                  </div>
                ) : null}

                <div className="rounded-[1.3rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.7)] p-4 text-sm leading-7 text-slate-600">
                  {selectedText
                    ? getExcerpt(selectedText, 220)
                    : "Select a passage in the editor to run AI on that region."}
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
                {assistantBusy ? (
                  <button
                    type="button"
                    onClick={() => void handleCancelAssistant()}
                    className="button-ghost h-11 rounded-full"
                  >
                    Cancel generation
                  </button>
                ) : null}

                {assistantResult ? (
                  <div
                    data-testid="assistant-suggestion"
                    className="space-y-3 rounded-[1.5rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.78)] p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="field-shell">
                        <span className="field-label">Original</span>
                        <textarea
                          value={assistantOriginal}
                          readOnly
                          rows={6}
                          className="field-area"
                        />
                      </label>
                      <label className="field-shell">
                        <span className="field-label">Suggestion</span>
                        <textarea
                          value={assistantResult}
                          onChange={(event) => setAssistantResult(event.target.value)}
                          rows={6}
                          className="field-area"
                        />
                      </label>
                    </div>

                    <AssistantDiffPreview
                      segments={diffSegments}
                      selection={segmentSelection}
                      onToggle={(id, checked) =>
                        setSegmentSelection((current) => ({
                          ...current,
                          [id]: checked,
                        }))
                      }
                    />

                    <div className="grid gap-2 sm:grid-cols-4">
                      <button
                        type="button"
                        onClick={() => void applyAssistantResult("accept-all")}
                        className="button-ink h-11 rounded-full"
                      >
                        Accept all
                      </button>
                      <button
                        type="button"
                        onClick={() => void applyAssistantResult("partial")}
                        className="button-wash h-11 rounded-full"
                      >
                        Apply selected
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

                {undoStackRef.current.length > 0 ? (
                  <button
                    type="button"
                    onClick={undoLastAssistantApply}
                    className="button-ghost h-11 rounded-full"
                  >
                    Undo last AI apply
                  </button>
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
                    Collaborator controls are available only for the owner role.
                  </div>
                )}
              </div>
            </section>

            <section className="glass-panel rounded-[1.9rem] p-5">
              <div className="section-kicker">Share links</div>
              {canManageCollaborators(role) ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={newShareRole}
                      onChange={(event) => setNewShareRole(event.target.value as UserRole)}
                      className="field-select"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="commenter">Commenter</option>
                      <option value="editor">Editor</option>
                    </select>
                    <select
                      value={newShareMode}
                      onChange={(event) => setNewShareMode(event.target.value as "authenticated" | "public")}
                      className="field-select"
                    >
                      <option value="authenticated">Authenticated link</option>
                      <option value="public">Public link</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateShareLink()}
                    className="button-wash h-11 rounded-full"
                  >
                    Create share link
                  </button>
                  <div className="space-y-2">
                    {shareLinks.length === 0 ? (
                      <div className="text-sm text-slate-500">No active share links.</div>
                    ) : (
                      shareLinks.map((link) => (
                        <div
                          key={link.id}
                          className="rounded-[1rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.64)] p-3"
                        >
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                            {link.access_mode} · {link.role}
                          </div>
                          <div className="mt-1 break-all text-xs text-slate-600">
                            {typeof window !== "undefined"
                              ? `${window.location.origin}/share/${link.token}`
                              : link.token}
                          </div>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleRevokeShareLink(link.id)}
                              className="button-ghost rounded-full px-3 py-1 text-xs font-semibold"
                            >
                              Revoke
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">Only owners can create or revoke share links.</div>
              )}
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
