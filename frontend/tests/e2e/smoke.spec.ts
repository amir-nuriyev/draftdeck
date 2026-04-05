import { expect, test } from "@playwright/test";

const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8000/api";

test("cockpit flow covers edit, assistant, sharing, export, and viewer gating", async ({
  page,
  request,
}) => {
  let draftId: number | null = null;

  try {
    const unique = Date.now();
    const draftTitle = `UI Smoke Draft ${unique}`;
    const starterCopy =
      "DraftDeck lets writers collaborate in stages while the assistant proposes targeted edits.";

    const createDraft = await request.post(`${apiBaseUrl}/drafts`, {
      data: {
        title: draftTitle,
        brief: "UI smoke coverage for the board and cockpit.",
        content: starterCopy,
        stage: "concept",
        accent: "ember",
        create_snapshot: true,
      },
      headers: { "X-User-Id": "1" },
    });
    expect(createDraft.ok()).toBeTruthy();

    draftId = Number((await createDraft.json()).id);
    expect(draftId).toBeTruthy();

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.localStorage.setItem("draftdeck-persona", "owner");
    });
    await page.goto(`/drafts/${draftId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(draftTitle);

    await expect(page.getByText("Assistant dock")).toBeVisible();
    await expect(page.getByText("Team access")).toBeVisible();

    const editor = page.getByLabel("Editor");
    await editor.fill(
      `${starterCopy}\n\nThis pass checks save, assistant, snapshots, sharing, exports, and role gating.`,
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved to the backend.")).toBeVisible();

    await page.getByPlaceholder("Checkpoint label").fill("UI checkpoint");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Snapshot stored.")).toBeVisible();
    await expect(page.getByText("UI checkpoint")).toBeVisible();

    await editor.evaluate((node) => {
      node.focus();
      node.selectionStart = 0;
      node.selectionEnd = 40;
      node.dispatchEvent(new Event("select", { bubbles: true }));
      node.dispatchEvent(new Event("keyup", { bubbles: true }));
    });

    await page.getByLabel("Feature").selectOption("translate");
    await page.getByLabel("Target language").fill("Georgian");
    await page.getByRole("button", { name: "Generate suggestion" }).click();
    await expect(page.getByText("Suggestion", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add as note" }).click();
    await expect(page.getByText(/translate · partial/i)).toBeVisible();

    const viewerShare = page.getByTestId("share-role-4");
    await viewerShare.selectOption("viewer");
    await expect(viewerShare).toHaveValue("viewer");
    await expect(page.getByText("Collaborator access updated.")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export md" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/ui-smoke-draft-.*\.md$/);

    await page.getByRole("button", { name: "Viewer" }).click();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Generate suggestion" }),
    ).toBeDisabled();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    const viewerRead = await request.get(`${apiBaseUrl}/drafts/${draftId}`, {
      headers: { "X-User-Id": "4" },
    });
    expect(viewerRead.ok()).toBeTruthy();
  } finally {
    if (draftId !== null) {
      await request.delete(`${apiBaseUrl}/drafts/${draftId}`, {
        headers: { "X-User-Id": "1" },
      });
    }
  }
});
