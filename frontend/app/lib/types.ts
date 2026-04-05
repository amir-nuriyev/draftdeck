export type UserRole = "owner" | "editor" | "commenter" | "viewer";

export type DraftStage = "concept" | "drafting" | "review";
export type AssistantFeature = "rewrite" | "summarize" | "translate" | "restructure";
export type AssistantDecision = "pending" | "accepted" | "rejected" | "partial";

export type DraftSummary = {
  id: number;
  title: string;
  brief: string;
  stage: DraftStage;
  accent: string;
  owner_id: number;
  owner_name: string;
  my_role: UserRole;
  created_at: string;
  updated_at: string;
};

export type DraftRecord = DraftSummary & {
  content: string;
};

export type SnapshotRecord = {
  id: number;
  draft_id: number;
  label: string | null;
  content: string;
  created_at: string;
};

export type CollaboratorRecord = {
  id: number;
  draft_id: number;
  member_id: number;
  role: UserRole;
  display_name: string;
  email: string;
  focus_area: string;
  color_hex: string;
};

export type MemberRecord = {
  id: number;
  email: string;
  display_name: string;
  focus_area: string;
  color_hex: string;
};

export type AssistantRun = {
  id: number;
  draft_id: number | null;
  member_id: number | null;
  member_display_name: string | null;
  feature: AssistantFeature;
  selection_text: string;
  context_excerpt: string;
  result_text: string;
  model_route: string;
  status: string;
  decision: AssistantDecision;
  target_language: string | null;
  selection_start: number | null;
  selection_end: number | null;
  applied_excerpt: string | null;
  created_at: string;
};

export type AssistantSuggestResponse = {
  run_id: number;
  feature: AssistantFeature;
  suggestion_text: string;
  model_name: string;
  provider: string;
  status: string;
  mocked: boolean;
  decision: AssistantDecision;
};

export type HealthResponse = {
  status: string;
  app_name: string;
  assistant_mode: "mock" | "live";
};

export type SessionCapabilities = {
  can_create_draft: boolean;
  can_view_draft: boolean;
  can_edit_draft: boolean;
  can_use_assistant: boolean;
  can_create_snapshot: boolean;
  can_restore_snapshot: boolean;
  can_manage_collaborators: boolean;
};

export type SessionRecord = {
  auth_mode: "demo-header";
  member: MemberRecord;
  draft_id: number | null;
  draft_role: UserRole | null;
  capabilities: SessionCapabilities;
};

export type StudioOverview = {
  app_name: string;
  accessible_drafts: number;
  concept_count: number;
  drafting_count: number;
  review_count: number;
  active_members: number;
  assistant_mode: "mock" | "live";
};

export const roleOptions: Array<{
  value: UserRole;
  label: string;
  description: string;
}> = [
  {
    value: "owner",
    label: "Owner",
    description: "Controls sharing, snapshot restores, and the full editing surface.",
  },
  {
    value: "editor",
    label: "Editor",
    description: "Can patch live copy, save snapshots, and invoke the assistant.",
  },
  {
    value: "commenter",
    label: "Commenter",
    description: "Sees the room, history, and output, but cannot alter draft content.",
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Read-only observer for demos and architecture walkthroughs.",
  },
];

export const stageOptions: Array<{
  value: DraftStage;
  label: string;
  badge: string;
}> = [
  { value: "concept", label: "Concept", badge: "linear-gradient(135deg, #fdba74, #f97316)" },
  { value: "drafting", label: "Drafting", badge: "linear-gradient(135deg, #5eead4, #0f766e)" },
  { value: "review", label: "Review", badge: "linear-gradient(135deg, #93c5fd, #2563eb)" },
];

export const assistantFeatureOptions: Array<{
  value: AssistantFeature;
  label: string;
}> = [
  { value: "rewrite", label: "Rewrite" },
  { value: "summarize", label: "Summarize" },
  { value: "translate", label: "Translate" },
  { value: "restructure", label: "Restructure" },
];

export function canEdit(role: UserRole) {
  return role === "owner" || role === "editor";
}

export function canUseAssistant(role: UserRole) {
  return role === "owner" || role === "editor";
}

export function canCreateSnapshots(role: UserRole) {
  return role === "owner" || role === "editor";
}

export function canRestoreSnapshots(role: UserRole) {
  return role === "owner";
}

export function canManageCollaborators(role: UserRole) {
  return role === "owner";
}
