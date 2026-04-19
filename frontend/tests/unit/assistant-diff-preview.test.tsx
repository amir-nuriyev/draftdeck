import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AssistantDiffPreview from "@/app/components/assistant-diff-preview";
import { buildDiffSegments, defaultSegmentSelection } from "@/app/lib/assistant-diff";

describe("AssistantDiffPreview", () => {
  it("shows change segments and emits toggle events", async () => {
    const user = userEvent.setup();
    const segments = buildDiffSegments("alpha beta", "alpha refined beta");
    const selection = defaultSegmentSelection(segments);
    const onToggle = vi.fn();

    render(
      <AssistantDiffPreview
        segments={segments}
        selection={selection}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("Partial acceptance")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);

    await user.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalled();
  });
});
