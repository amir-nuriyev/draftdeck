import { expect, test } from "@playwright/test";

import { createDraft, createShareLink, deleteDraft } from "./helpers";

test("public share link resolves in read preview mode", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Share Link ${Date.now()}`,
  });

  try {
    const link = await createShareLink(request, created.id, "public", "viewer");

    await page.goto(`/share/${link.token}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Share link", { exact: true })).toBeVisible();
    await expect(page.getByText(/Access: public/i)).toBeVisible();
    await expect(page.getByText(created.title)).toBeVisible();
  } finally {
    await deleteDraft(request, created.id);
  }
});
