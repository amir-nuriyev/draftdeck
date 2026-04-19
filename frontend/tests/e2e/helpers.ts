import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8000/api";

type DemoUser = "owner" | "editor" | "commenter" | "viewer";

const credentials: Record<DemoUser, { login: string; password: string }> = {
  owner: { login: "maya", password: "owner123" },
  editor: { login: "omar", password: "editor123" },
  commenter: { login: "irene", password: "comment123" },
  viewer: { login: "nika", password: "viewer123" },
};

export async function apiLogin(request: APIRequestContext, user: DemoUser = "owner") {
  const response = await request.post(`${apiBaseUrl}/auth/login`, {
    data: credentials[user],
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
  };
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
  const { accessToken } = await apiLogin(request, "owner");
  const response = await request.post(`${apiBaseUrl}/drafts`, {
    data: {
      title: `Draft ${Date.now()}`,
      brief: "Playwright fixture draft",
      content: "<p>Initial DraftDeck content for browser tests.</p>",
      stage: "concept",
      accent: "ember",
      create_snapshot: true,
      ...overrides,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  return {
    ...(await response.json()),
    accessToken,
  } as {
    id: number;
    title: string;
    brief: string;
    content: string;
    stage: string;
    accent: string;
    accessToken: string;
  };
}

export async function deleteDraft(request: APIRequestContext, draftId: number) {
  const { accessToken } = await apiLogin(request, "owner");
  await request.delete(`${apiBaseUrl}/drafts/${draftId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function shareDraft(
  request: APIRequestContext,
  draftId: number,
  memberId: number,
  role: "editor" | "commenter" | "viewer",
) {
  const { accessToken } = await apiLogin(request, "owner");
  const response = await request.post(`${apiBaseUrl}/drafts/${draftId}/collaborators`, {
    data: {
      member_id: memberId,
      role,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
}

export async function createShareLink(
  request: APIRequestContext,
  draftId: number,
  mode: "public" | "authenticated" = "public",
  role: "viewer" | "commenter" | "editor" = "viewer",
) {
  const { accessToken } = await apiLogin(request, "owner");
  const response = await request.post(`${apiBaseUrl}/drafts/${draftId}/share-links`, {
    data: {
      access_mode: mode,
      role,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ id: number; token: string }>;
}

export async function loginViaUi(page: Page, user: DemoUser = "owner") {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByPlaceholder("Email or username").fill(credentials[user].login);
  await page.getByPlaceholder("Password").fill(credentials[user].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible();
}

export async function openDraftAs(page: Page, draftId: number, user: DemoUser) {
  await loginViaUi(page, user);
  await page.goto(`/drafts/${draftId}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("connection-status")).toHaveText("Live");
}

export async function replaceEditorContent(page: Page, value: string) {
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value);
}

export async function selectAllInEditor(page: Page) {
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.press("Control+A");
}
