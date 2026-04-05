import { expect, test } from "@playwright/test";

import {
  createDraft,
  deleteDraft,
  openDraft,
  selectEditorRange,
  shareDraft,
} from "./helpers";

test("two browser sessions show presence, live patches, and assistant status", async ({
  browser,
  request,
}) => {
  const created = await createDraft(request, {
    title: `Realtime Flow ${Date.now()}`,
    content: "Realtime shared content.",
  });

  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const editorPage = await editorContext.newPage();

  try {
    await shareDraft(request, created.id, 2, "editor");

    await openDraft(ownerPage, created.id, "owner", created.title);
    await openDraft(editorPage, created.id, "editor", created.title);

    await expect(ownerPage.getByTestId("connection-status")).toHaveText("Live");
    await expect(editorPage.getByTestId("connection-status")).toHaveText("Live");
    await expect(ownerPage.getByTestId("presence-card-2")).toContainText("Omar Vale");

    const editorArea = editorPage.getByLabel("Editor");
    await editorArea.fill("Realtime shared content.\nEditor added a visible live patch.");

    await expect(ownerPage.getByTestId("remote-notice")).toContainText("Omar Vale pushed a live patch.");
    await expect(ownerPage.getByLabel("Editor")).toHaveValue(/Editor added a visible live patch\./);

    await selectEditorRange(editorPage, 0, 20);
    await editorPage.getByRole("button", { name: "Generate suggestion" }).click();

    await expect(ownerPage.getByTestId("remote-notice")).toContainText(
      "Omar Vale is running rewrite",
    );
  } finally {
    await ownerContext.close();
    await editorContext.close();
    await deleteDraft(request, created.id);
  }
});

test("overlapping edits surface a conflict warning in the UI", async ({ browser, request }) => {
  const created = await createDraft(request, {
    title: `Conflict Flow ${Date.now()}`,
    content: "Overlap region content for collaboration warnings.",
  });

  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const editorPage = await editorContext.newPage();

  try {
    await shareDraft(request, created.id, 2, "editor");

    await openDraft(ownerPage, created.id, "owner", created.title);
    await openDraft(editorPage, created.id, "editor", created.title);

    await expect(ownerPage.getByTestId("connection-status")).toHaveText("Live");
    await expect(editorPage.getByTestId("connection-status")).toHaveText("Live");

    await selectEditorRange(ownerPage, 0, 12);
    await expect(editorPage.getByTestId("presence-card-1")).toContainText("0-12");

    await selectEditorRange(editorPage, 5, 5);
    await editorPage.keyboard.type("!");

    await expect(editorPage.getByTestId("remote-notice")).toContainText(
      "Potential edit conflict detected in the same region.",
    );
  } finally {
    await ownerContext.close();
    await editorContext.close();
    await deleteDraft(request, created.id);
  }
});

test("connection status reflects offline and reconnect transitions", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Reconnect Flow ${Date.now()}`,
  });

  try {
    await openDraft(page, created.id, "owner", created.title);
    await expect(page.getByTestId("connection-status")).toHaveText("Live");

    await page.context().setOffline(true);
    await expect(page.getByTestId("connection-status")).toHaveText("Offline");

    await page.context().setOffline(false);
    await expect(page.getByTestId("connection-status")).toHaveText("Live", {
      timeout: 15_000,
    });
  } finally {
    await page.context().setOffline(false);
    await deleteDraft(request, created.id);
  }
});
