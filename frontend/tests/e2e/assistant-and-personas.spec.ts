import { expect, test } from "@playwright/test";

import { createDraft, deleteDraft, openDraftAs, shareDraft } from "./helpers";

test("role enforcement blocks viewer edits and assistant actions", async ({ browser, request }) => {
  const created = await createDraft(request, {
    title: `Role Gating ${Date.now()}`,
  });

  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const viewerPage = await viewerContext.newPage();

  try {
    await shareDraft(request, created.id, 4, "viewer");

    await openDraftAs(ownerPage, created.id, "owner");
    await openDraftAs(viewerPage, created.id, "viewer");

    await expect(ownerPage.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await expect(ownerPage.getByRole("button", { name: "Generate suggestion" })).toBeEnabled();

    await expect(viewerPage.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await expect(viewerPage.getByRole("button", { name: "Generate suggestion" })).toBeDisabled();
  } finally {
    await ownerContext.close();
    await viewerContext.close();
    await deleteDraft(request, created.id);
  }
});
