import { API_BASE_URL } from "./config";
import type {
  AssistantRun,
  AssistantSuggestResponse,
  CollaboratorRecord,
  DraftRecord,
  DraftSummary,
  HealthResponse,
  MemberRecord,
  SessionRecord,
  SnapshotRecord,
  StudioOverview,
} from "./types";
import { getDemoIdentityFromStoredRole } from "./ui";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

type ErrorShape = {
  detail?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const identity = getDemoIdentityFromStoredRole();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(identity.userId),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const rawBody = await response.text();
  const data = rawBody ? (JSON.parse(rawBody) as ErrorShape | T) : null;

  if (!response.ok) {
    const detail =
      typeof (data as ErrorShape | null)?.detail === "string"
        ? (data as ErrorShape).detail!
        : `Request failed with status ${response.status}.`;
    throw new ApiError(detail, response.status);
  }

  return data as T;
}

async function downloadRequest(path: string): Promise<Blob> {
  const identity = getDemoIdentityFromStoredRole();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "X-User-Id": String(identity.userId),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let message = `Request failed with status ${response.status}.`;

    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as ErrorShape;
        if (typeof parsed.detail === "string") {
          message = parsed.detail;
        }
      } catch {
        message = rawBody;
      }
    }

    throw new ApiError(message, response.status);
  }

  return response.blob();
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
  payload: { member_id: number; role: "owner" | "editor" | "commenter" | "viewer" },
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
  feature?: "rewrite" | "summarize" | "translate" | "restructure";
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
  feature: "rewrite" | "summarize" | "translate" | "restructure";
  selected_text: string;
  surrounding_context: string;
  target_language?: string;
  draft_id?: number;
  selection_start?: number;
  selection_end?: number;
}) {
  return apiRequest<AssistantSuggestResponse>("/assistant/suggest", {
    method: "POST",
    body: payload,
  });
}

export function updateAssistantDecision(
  runId: number,
  payload: {
    decision: "pending" | "accepted" | "rejected" | "partial";
    applied_excerpt?: string;
  },
) {
  return apiRequest<AssistantRun>(`/assistant/runs/${runId}`, {
    method: "PATCH",
    body: payload,
  });
}
