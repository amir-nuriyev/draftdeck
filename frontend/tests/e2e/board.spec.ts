import { expect, test } from "@playwright/test";

import { deleteDraft, openBoard } from "./helpers";

test("board creates a draft through the UI", async ({ page, request }) => {
  let draftId: number | null = null;

  try {
    await openBoard(page, "owner");

    const unique = Date.now();
    const draftTitle = `Board Created Draft ${unique}`;

    await page.getByLabel("Title").fill(draftTitle);
    await page.getByLabel("Brief").fill("Created from the board form.");
    await page.getByLabel("Starter copy").fill("Board flow starter copy.");
    await page.getByLabel("Lane").selectOption("review");
    await page.getByRole("button", { name: "Orchid" }).click();
    await page.getByTestId("create-draft-button").click();

    await page.waitForURL(/\/drafts\/\d+$/);
    draftId = Number(page.url().match(/\/drafts\/(\d+)$/)?.[1]);
    expect(draftId).toBeTruthy();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(draftTitle);
    await expect(page.getByTestId("connection-status")).toHaveText("Live");
  } finally {
    if (draftId !== null) {
      await deleteDraft(request, draftId);
    }
  }
});

test("board shows validation when title is missing", async ({ page }) => {
  await openBoard(page, "owner");

  await page.getByTestId("create-draft-button").click();

  await expect(page.getByTestId("board-error")).toContainText(
    "Add a draft title before creating it.",
  );
});
