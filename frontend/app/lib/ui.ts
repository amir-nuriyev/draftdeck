import type { DraftStage, UserRole } from "./types";

export const roleStorageKey = "draftdeck-persona";

const demoUserIds: Record<UserRole, number> = {
  owner: 1,
  editor: 2,
  commenter: 3,
  viewer: 4,
};

const demoUserNames: Record<UserRole, string> = {
  owner: "Maya Stone",
  editor: "Omar Vale",
  commenter: "Irene Park",
  viewer: "Nika Ross",
};

export const accentOptions = [
  { value: "ember", label: "Ember", color: "#d97706" },
  { value: "tidal", label: "Tidal", color: "#0f766e" },
  { value: "lagoon", label: "Lagoon", color: "#2563eb" },
  { value: "orchid", label: "Orchid", color: "#7c3aed" },
] as const;

export function readStoredRole(): UserRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  const role = window.localStorage.getItem(roleStorageKey);
  if (
    role === "owner" ||
    role === "editor" ||
    role === "commenter" ||
    role === "viewer"
  ) {
    return role;
  }

  return null;
}

export function writeStoredRole(role: UserRole) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(roleStorageKey, role);
}

export function getStoredRoleOrDefault(): UserRole {
  return readStoredRole() ?? "owner";
}

export function getDemoUserIdForRole(role: UserRole) {
  return demoUserIds[role];
}

export function getDemoIdentityForRole(role: UserRole) {
  return {
    role,
    userId: getDemoUserIdForRole(role),
    userName: demoUserNames[role],
  };
}

export function getDemoIdentityFromStoredRole() {
  return getDemoIdentityForRole(getStoredRoleOrDefault());
}

export function getRoleForDemoUserId(userId: number | string): UserRole {
  const numericId = Number(userId);
  if (numericId === 1) {
    return "owner";
  }
  if (numericId === 2) {
    return "editor";
  }
  if (numericId === 3) {
    return "commenter";
  }
  return "viewer";
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function getExcerpt(content: string, length = 140) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "No content yet. Open the document to start writing.";
  }

  return compact.length > length ? `${compact.slice(0, length)}...` : compact;
}

export function accentPreview(accent: string) {
  return accentOptions.find((option) => option.value === accent)?.color ?? "#18181b";
}

export function stageLabel(stage: DraftStage) {
  if (stage === "concept") {
    return "Concept";
  }
  if (stage === "drafting") {
    return "Drafting";
  }
  return "Review";
}
