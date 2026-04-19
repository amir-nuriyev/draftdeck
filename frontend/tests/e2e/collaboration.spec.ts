import { expect, test } from "@playwright/test";

import { createDraft, deleteDraft, openDraftAs, replaceEditorContent, shareDraft } from "./helpers";

test("two sessions sync collaborative edits and presence", async ({ browser, request }) => {
  const created = await createDraft(request, {
    title: `Realtime Flow ${Date.now()}`,
    content: "<p>Realtime shared content.</p>",
  });

  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const editorPage = await editorContext.newPage();

  try {
    await shareDraft(request, created.id, 2, "editor");

    await openDraftAs(ownerPage, created.id, "owner");
    await openDraftAs(editorPage, created.id, "editor");

    await expect(ownerPage.getByTestId("presence-card-2")).toContainText("Omar Vale", {
      timeout: 20_000,
    });

    await replaceEditorContent(editorPage, "Realtime shared content updated by editor session.");
    await expect(ownerPage.locator(".ProseMirror")).toContainText("updated by editor session", {
      timeout: 20_000,
    });
  } finally {
    await ownerContext.close();
    await editorContext.close();
    await deleteDraft(request, created.id);
  }
});
