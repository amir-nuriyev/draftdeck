import { expect, test } from "@playwright/test";

import { deleteDraft, loginViaUi, replaceEditorContent, selectAllInEditor } from "./helpers";

test("login to AI acceptance happy path", async ({ page, request }) => {
  let draftId: number | null = null;

  try {
    await loginViaUi(page, "owner");

    await page.getByPlaceholder("Quarterly launch narrative").fill(`A2 Happy Path ${Date.now()}`);
    await page.getByPlaceholder("One-line summary for the board card").fill("Playwright end-to-end flow");
    await page.getByPlaceholder("Paste notes, a prompt, or a first paragraph.").fill(
      "Initial collaborative content for A2 verification.",
    );
    await page.getByTestId("create-draft-button").click();

    await expect(page).toHaveURL(/\/drafts\/\d+/);
    const matched = /\/drafts\/(\d+)/.exec(page.url());
    draftId = matched ? Number(matched[1]) : null;
    expect(draftId).toBeTruthy();

    await replaceEditorContent(
      page,
      "DraftDeck helps teams edit together while AI suggests better wording in real time.",
    );

    await expect(page.getByTestId("autosave-status")).toContainText("saving");
    await expect(page.getByTestId("autosave-status")).toContainText("saved", {
      timeout: 20_000,
    });

    await selectAllInEditor(page);
    await page.getByRole("button", { name: "Generate suggestion" }).click();

    await expect(page.getByTestId("assistant-suggestion")).toBeVisible();
    await page.getByRole("button", { name: "Accept all" }).click();

    await expect(page.locator(".ProseMirror")).toContainText(/rewrite/i, {
      timeout: 20_000,
    });
  } finally {
    if (draftId) {
      await deleteDraft(request, draftId);
    }
  }
});
