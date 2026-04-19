import { expect, test } from "@playwright/test";

import { loginViaUi } from "./helpers";

test("board loads for authenticated user", async ({ page }) => {
  await loginViaUi(page, "owner");

  await expect(page.getByText("DraftDeck keeps collaborative writing visible")).toBeVisible();
  await expect(page.getByTestId("session-summary")).toContainText("Session mode:");
});
