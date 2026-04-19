import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AutosaveIndicator from "@/app/components/autosave-indicator";

describe("AutosaveIndicator", () => {
  it("renders saving state and dirty message", () => {
    render(<AutosaveIndicator status="saving" dirty />);

    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Autosave: saving");
    expect(screen.getByText("Unsaved changes will autosave.")).toBeInTheDocument();
  });

  it("renders offline state and clean message", () => {
    render(<AutosaveIndicator status="offline" dirty={false} />);

    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Autosave: offline");
    expect(screen.getByText("Editor state matches the backend.")).toBeInTheDocument();
  });
});
