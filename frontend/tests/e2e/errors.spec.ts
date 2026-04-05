import { expect, test } from "@playwright/test";

import { createDraft, deleteDraft, openDraft, setPersona } from "./helpers";

test("viewer sees an access error for a private draft", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Private Draft ${Date.now()}`,
  });

  try {
    await openDraft(page, created.id, "viewer");

    await expect(page.getByTestId("draft-error")).toContainText(
      "You do not have permission to perform this action in this draft.",
    );
  } finally {
    await deleteDraft(request, created.id);
  }
});

test("invalid draft ids fail gracefully in the UI", async ({ page }) => {
  await setPersona(page, "owner");
  await page.goto("/drafts/not-a-number", { waitUntil: "networkidle" });

  await expect(page.getByTestId("draft-error")).toContainText("Invalid draft id.");
});
