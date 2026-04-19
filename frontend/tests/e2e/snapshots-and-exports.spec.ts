import { expect, test } from "@playwright/test";

import { createDraft, deleteDraft, openDraftAs } from "./helpers";

test("snapshot creation and markdown export", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Snapshot Export ${Date.now()}`,
  });

  try {
    await openDraftAs(page, created.id, "owner");

    await page.getByPlaceholder("Checkpoint label").fill("Checkpoint A");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Snapshot stored.")).toBeVisible();
    await expect(page.getByText("Checkpoint A")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export md" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/snapshot-export-.*\.md$/);
  } finally {
    await deleteDraft(request, created.id);
  }
});
