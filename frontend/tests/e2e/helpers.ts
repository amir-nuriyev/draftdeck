import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8000/api";

export type DemoRole = "owner" | "editor" | "commenter" | "viewer";

export async function setPersona(page: Page, role: DemoRole) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((nextRole) => {
    window.localStorage.setItem("draftdeck-persona", nextRole);
  }, role);
}

export async function openBoard(page: Page, role: DemoRole = "owner") {
  await setPersona(page, role);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("session-summary")).toContainText("Session mode:");
}

export async function openDraft(
  page: Page,
  draftId: number,
  role: DemoRole,
  expectedTitle?: string,
) {
  await setPersona(page, role);
  await page.goto(`/drafts/${draftId}`, { waitUntil: "networkidle" });
  if (expectedTitle) {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(expectedTitle);
  }
}

export async function createDraft(
  request: APIRequestContext,
  overrides: Partial<{
    title: string;
    brief: string;
    content: string;
    stage: "concept" | "drafting" | "review";
    accent: string;
    create_snapshot: boolean;
  }> = {},
) {
  const response = await request.post(`${apiBaseUrl}/drafts`, {
    data: {
      title: `Draft ${Date.now()}`,
      brief: "Playwright fixture draft",
      content: "Initial DraftDeck content for browser tests.",
      stage: "concept",
      accent: "ember",
      create_snapshot: true,
      ...overrides,
    },
    headers: { "X-User-Id": "1" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    id: number;
    title: string;
    brief: string;
    content: string;
    stage: string;
    accent: string;
  };
}

export async function deleteDraft(request: APIRequestContext, draftId: number) {
  await request.delete(`${apiBaseUrl}/drafts/${draftId}`, {
    headers: { "X-User-Id": "1" },
  });
}

export async function shareDraft(
  request: APIRequestContext,
  draftId: number,
  memberId: number,
  role: Exclude<DemoRole, "owner">,
) {
  const response = await request.post(`${apiBaseUrl}/drafts/${draftId}/collaborators`, {
    data: {
      member_id: memberId,
      role,
    },
    headers: { "X-User-Id": "1" },
  });
  expect(response.ok()).toBeTruthy();
}

export async function createSnapshotVersion(
  request: APIRequestContext,
  draftId: number,
  content: string,
  snapshotLabel = "Changed version",
) {
  const response = await request.patch(`${apiBaseUrl}/drafts/${draftId}`, {
    data: {
      content,
      create_snapshot: true,
      snapshot_label: snapshotLabel,
    },
    headers: { "X-User-Id": "1" },
  });
  expect(response.ok()).toBeTruthy();
}

export async function listSnapshots(request: APIRequestContext, draftId: number) {
  const response = await request.get(`${apiBaseUrl}/drafts/${draftId}/snapshots`, {
    headers: { "X-User-Id": "1" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{
    id: number;
    label: string | null;
    content: string;
    created_at: string;
  }>;
}

export async function selectEditorRange(page: Page, start: number, end: number) {
  await page.getByLabel("Editor").evaluate(
    (node, range) => {
      const editor = node as HTMLTextAreaElement;
      editor.focus();
      editor.selectionStart = range.start;
      editor.selectionEnd = range.end;
      editor.dispatchEvent(new Event("select", { bubbles: true }));
      editor.dispatchEvent(new Event("keyup", { bubbles: true }));
    },
    { start, end },
  );
}
