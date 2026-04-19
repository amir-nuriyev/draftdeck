import { API_BASE_URL } from "./config";
import { clearAuthTokens, getAccessToken, getRefreshToken, refreshAccessToken, setAuthTokens } from "./auth";
import type {
  AssistantFeature,
  AssistantRun,
  AssistantSuggestResponse,
  AuthTokenRecord,
  CollaboratorRecord,
  DraftRecord,
  DraftSummary,
  HealthResponse,
  MemberRecord,
  SessionRecord,
  ShareLinkRecord,
  ShareResolveRecord,
  SnapshotRecord,
  StudioOverview,
  UserRole,
} from "./types";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipAuthRefresh?: boolean;
};

type ErrorShape = {
  detail?: string;
};

type StreamCallbacks = {
  signal?: AbortSignal;
  onStart?: (payload: { run_id: number; model_name: string; provider: string; mocked: boolean }) => void;
  onChunk?: (text: string) => void;
  onDone?: () => void;
  onCanceled?: () => void;
  onError?: (message: string) => void;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildAuthHeaders(headers: HeadersInit | undefined): HeadersInit {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers ?? {}),
  };
}

async function parseError(response: Response): Promise<ApiError> {
  const rawBody = await response.text();
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as ErrorShape;
      if (typeof parsed.detail === "string") {
        return new ApiError(parsed.detail, response.status);
      }
    } catch {
      return new ApiError(rawBody, response.status);
    }
  }
  return new ApiError(`Request failed with status ${response.status}.`, response.status);
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildAuthHeaders(options.headers),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipAuthRefresh: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  const rawBody = await response.text();
  return (rawBody ? JSON.parse(rawBody) : null) as T;
}

async function downloadRequest(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: buildAuthHeaders(undefined),
    cache: "no-store",
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return downloadRequest(path);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.blob();
}

export async function streamSuggestion(
  payload: {
    feature: AssistantFeature;
    selected_text: string;
    surrounding_context: string;
    target_language?: string;
    draft_id?: number;
    selection_start?: number;
    selection_end?: number;
    tone?: string;
    output_length?: string;
    custom_prompt?: string;
  },
  callbacks: StreamCallbacks = {},
) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}/assistant/suggest/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: callbacks.signal,
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return streamSuggestion(payload, callbacks);
    }
  }
  if (!response.ok) {
    throw await parseError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError("Streaming body is unavailable.", 500);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const eventBlock of events) {
      if (!eventBlock.trim()) {
        continue;
      }
      const lines = eventBlock.split("\n");
      const eventName = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim();
      const dataRaw = lines.find((line) => line.startsWith("data:"))?.replace("data:", "").trim() ?? "{}";
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      if (eventName === "start") {
        callbacks.onStart?.({
          run_id: Number(data.run_id),
          model_name: String(data.model_name ?? ""),
          provider: String(data.provider ?? ""),
          mocked: Boolean(data.mocked),
        });
      }
      if (eventName === "chunk") {
        callbacks.onChunk?.(String(data.text ?? ""));
      }
      if (eventName === "done") {
        callbacks.onDone?.();
      }
      if (eventName === "canceled") {
        callbacks.onCanceled?.();
      }
      if (eventName === "error") {
        callbacks.onError?.(String(data.message ?? "Streaming error"));
      }
    }
  }
}

export function getHealth() {
  return apiRequest<HealthResponse>("/health");
}

export function getSession(draftId?: number) {
  const suffix = draftId === undefined ? "" : `?draft_id=${draftId}`;
  return apiRequest<SessionRecord>(`/session${suffix}`);
}

export function getStudioOverview() {
  return apiRequest<StudioOverview>("/studio/overview");
}

export function listDrafts() {
  return apiRequest<DraftSummary[]>("/drafts");
}

export function createDraft(payload: {
  title: string;
  brief: string;
  content: string;
  stage: "concept" | "drafting" | "review";
  accent: string;
  create_snapshot: boolean;
}) {
  return apiRequest<DraftRecord>("/drafts", {
    method: "POST",
    body: payload,
  });
}

export function getDraft(draftId: number) {
  return apiRequest<DraftRecord>(`/drafts/${draftId}`);
}

export function updateDraft(
  draftId: number,
  payload: {
    title?: string;
    brief?: string;
    content?: string;
    stage?: "concept" | "drafting" | "review";
    accent?: string;
    create_snapshot?: boolean;
    snapshot_label?: string;
  },
) {
  return apiRequest<DraftRecord>(`/drafts/${draftId}`, {
    method: "PATCH",
    body: payload,
  });
}

export function listSnapshots(draftId: number) {
  return apiRequest<SnapshotRecord[]>(`/drafts/${draftId}/snapshots`);
}

export function createSnapshot(draftId: number, payload: { label?: string }) {
  return apiRequest<SnapshotRecord>(`/drafts/${draftId}/snapshots`, {
    method: "POST",
    body: payload,
  });
}

export function restoreSnapshot(draftId: number, snapshotId: number) {
  return apiRequest<DraftRecord>(`/drafts/${draftId}/snapshots/${snapshotId}/restore`, {
    method: "POST",
  });
}

export function listCollaborators(draftId: number) {
  return apiRequest<CollaboratorRecord[]>(`/drafts/${draftId}/collaborators`);
}

export function upsertCollaborator(
  draftId: number,
  payload: { member_id: number; role: UserRole },
) {
  return apiRequest<CollaboratorRecord>(`/drafts/${draftId}/collaborators`, {
    method: "POST",
    body: payload,
  });
}

export function deleteCollaborator(draftId: number, memberId: number) {
  return apiRequest<void>(`/drafts/${draftId}/collaborators/${memberId}`, {
    method: "DELETE",
  });
}

export function exportDraft(draftId: number, format: "md" | "txt" | "json") {
  return downloadRequest(`/drafts/${draftId}/export?format=${format}`);
}

export function listMembers() {
  return apiRequest<MemberRecord[]>("/members");
}

export function getCurrentMember() {
  return apiRequest<MemberRecord>("/members/me");
}

export function listAssistantRuns(params?: {
  draft_id?: number;
  feature?: AssistantFeature;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (params?.draft_id !== undefined) {
    search.set("draft_id", String(params.draft_id));
  }
  if (params?.feature) {
    search.set("feature", params.feature);
  }
  if (params?.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  const suffix = search.size ? `?${search.toString()}` : "";
  return apiRequest<AssistantRun[]>(`/assistant/runs${suffix}`);
}

export function requestSuggestion(payload: {
  feature: AssistantFeature;
  selected_text: string;
  surrounding_context: string;
  target_language?: string;
  draft_id?: number;
  selection_start?: number;
  selection_end?: number;
  tone?: string;
  output_length?: string;
  custom_prompt?: string;
}) {
  return apiRequest<AssistantSuggestResponse>("/assistant/suggest", {
    method: "POST",
    body: payload,
  });
}

export function updateAssistantDecision(
  runId: number,
  payload: {
    decision: "pending" | "accepted" | "rejected" | "partial" | "canceled";
    applied_excerpt?: string;
  },
) {
  return apiRequest<AssistantRun>(`/assistant/runs/${runId}`, {
    method: "PATCH",
    body: payload,
  });
}

export function cancelAssistantRun(runId: number) {
  return apiRequest<{ status: string; run_id: number }>(`/assistant/runs/${runId}/cancel`, {
    method: "POST",
  });
}

export function listShareLinks(draftId: number) {
  return apiRequest<ShareLinkRecord[]>(`/drafts/${draftId}/share-links`);
}

export function createShareLink(
  draftId: number,
  payload: { role: UserRole; access_mode: "authenticated" | "public"; expires_at?: string | null },
) {
  return apiRequest<ShareLinkRecord>(`/drafts/${draftId}/share-links`, {
    method: "POST",
    body: payload,
  });
}

export function revokeShareLink(draftId: number, linkId: number) {
  return apiRequest<void>(`/drafts/${draftId}/share-links/${linkId}`, {
    method: "DELETE",
  });
}

export function resolveShareLink(token: string) {
  return apiRequest<ShareResolveRecord>(`/share/${token}/resolve`);
}

export async function login(payload: { login: string; password: string }) {
  const tokens = await apiRequest<AuthTokenRecord>("/auth/login", {
    method: "POST",
    body: payload,
    skipAuthRefresh: true,
  });
  setAuthTokens(tokens);
  return tokens;
}

export async function register(payload: {
  email: string;
  username: string;
  display_name: string;
  password: string;
}) {
  const tokens = await apiRequest<AuthTokenRecord>("/auth/register", {
    method: "POST",
    body: payload,
    skipAuthRefresh: true,
  });
  setAuthTokens(tokens);
  return tokens;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearAuthTokens();
    return;
  }
  await apiRequest<void>("/auth/logout", {
    method: "POST",
    body: { refresh_token: refreshToken },
    skipAuthRefresh: true,
  }).catch(() => undefined);
  clearAuthTokens();
}

export function whoAmI() {
  return apiRequest<MemberRecord>("/auth/me");
}
