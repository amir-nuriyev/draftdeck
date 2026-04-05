import { expect, test } from "@playwright/test";

import {
  createDraft,
  deleteDraft,
  openDraft,
  selectEditorRange,
  shareDraft,
} from "./helpers";

test("assistant supports replace and dismiss flows", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Assistant Flow ${Date.now()}`,
    content:
      "DraftDeck helps teams rewrite sections, summarize ideas, and translate selected text during review.",
  });

  try {
    await openDraft(page, created.id, "owner", created.title);

    await selectEditorRange(page, 0, 35);
    await page.getByRole("button", { name: "Generate suggestion" }).click();
    await expect(page.getByTestId("assistant-suggestion")).toBeVisible();
    await page.getByRole("button", { name: "Replace" }).click();

    await expect(page.getByTestId("assistant-suggestion")).toBeHidden();
    await expect(page.getByLabel("Editor")).toHaveValue(/Polished pass:/);
    await expect(page.getByText(/rewrite · accepted/i)).toBeVisible();

    await selectEditorRange(page, 0, 20);
    await page.getByRole("button", { name: "Generate suggestion" }).click();
    await expect(page.getByTestId("assistant-suggestion")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();

    await expect(page.getByTestId("assistant-suggestion")).toBeHidden();
    await expect(page.getByText(/rewrite · rejected/i)).toBeVisible();
  } finally {
    await deleteDraft(request, created.id);
  }
});

test("assistant requires a text selection before running", async ({ page, request }) => {
  const created = await createDraft(request, {
    title: `Assistant Validation ${Date.now()}`,
  });

  try {
    await openDraft(page, created.id, "owner", created.title);

    await page.getByRole("button", { name: "Generate suggestion" }).click();

    await expect(page.getByTestId("assistant-error")).toContainText(
      "Select a passage in the editor before invoking the assistant.",
    );
  } finally {
    await deleteDraft(request, created.id);
  }
});

test("persona switching enforces editor, commenter, and viewer permissions", async ({
  page,
  request,
}) => {
  const created = await createDraft(request, {
    title: `Persona Gating ${Date.now()}`,
  });

  try {
    await shareDraft(request, created.id, 2, "editor");
    await shareDraft(request, created.id, 3, "commenter");
    await shareDraft(request, created.id, 4, "viewer");

    await openDraft(page, created.id, "owner", created.title);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Generate suggestion" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Restore" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Editor" }).click();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Generate suggestion" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
    await expect(page.getByText("Collaborator controls are only expanded for the owner persona")).toBeVisible();

    await page.getByRole("button", { name: "Commenter" }).click();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Generate suggestion" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

    await page.getByRole("button", { name: "Viewer" }).click();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Generate suggestion" })).toBeDisabled();
  } finally {
    await deleteDraft(request, created.id);
  }
});
