import { promises as fs } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  createDraft,
  createSnapshotVersion,
  deleteDraft,
  listSnapshots,
  openDraft,
  shareDraft,
} from "./helpers";

test("owner can restore an earlier snapshot through the UI", async ({ page, request }) => {
  const originalContent = "Original restore target content.";
  const created = await createDraft(request, {
    title: `Snapshot Restore ${Date.now()}`,
    content: originalContent,
  });

  try {
    await createSnapshotVersion(
      request,
      created.id,
      "Changed content that should be replaced by the restored snapshot.",
    );

    const snapshots = await listSnapshots(request, created.id);
    const originalSnapshot = snapshots.at(-1);
    expect(originalSnapshot).toBeTruthy();

    await openDraft(page, created.id, "owner", created.title);
    await page.getByTestId(`restore-snapshot-${originalSnapshot!.id}`).click();

    await expect(page.getByTestId("sidebar-message")).toContainText("Snapshot restored.");
    await expect(page.getByLabel("Editor")).toHaveValue(originalContent);
  } finally {
    await deleteDraft(request, created.id);
  }
});

test("viewer can export txt and json through the UI", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Export Paths ${Date.now()}`,
    content: "Viewer export body.",
  });

  try {
    await shareDraft(request, created.id, 4, "viewer");

    await openDraft(page, created.id, "viewer", created.title);

    const txtDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-txt").click();
    const txtDownload = await txtDownloadPromise;
    expect(txtDownload.suggestedFilename()).toMatch(/export-paths-.*\.txt$/);
    const txtPath = await txtDownload.path();
    expect(txtPath).toBeTruthy();
    expect(await fs.readFile(txtPath!, "utf8")).toContain("Viewer export body.");

    const jsonDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-json").click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/export-paths-.*\.json$/);
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).toBeTruthy();
    const jsonPayload = JSON.parse(await fs.readFile(jsonPath!, "utf8"));
    expect(jsonPayload.title).toBe(created.title);
    expect(jsonPayload.content).toContain("Viewer export body.");
  } finally {
    await deleteDraft(request, created.id);
  }
});
