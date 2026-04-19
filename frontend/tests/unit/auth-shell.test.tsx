import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authenticated = false;

const loginMock = vi.fn(async () => {
  authenticated = true;
});
const registerMock = vi.fn();
const logoutMock = vi.fn();
const whoAmIMock = vi.fn(async () => ({
  id: 1,
  email: "maya@draftdeck.local",
  username: "maya",
  display_name: "Maya Stone",
  focus_area: "Product lead",
  color_hex: "#d97706",
}));

vi.mock("@/app/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  login: (...args: unknown[]) => loginMock(...args),
  register: (...args: unknown[]) => registerMock(...args),
  logout: (...args: unknown[]) => logoutMock(...args),
  whoAmI: (...args: unknown[]) => whoAmIMock(...args),
}));

vi.mock("@/app/lib/auth", () => ({
  clearAuthTokens: vi.fn(),
  isAuthenticated: () => authenticated,
}));

import AuthShell from "@/app/components/auth-shell";

describe("AuthShell", () => {
  beforeEach(() => {
    authenticated = false;
    loginMock.mockClear();
    registerMock.mockClear();
    logoutMock.mockClear();
    whoAmIMock.mockClear();
  });

  it("completes login flow and renders authenticated shell", async () => {
    const user = userEvent.setup();
    render(
      <AuthShell>
        <div data-testid="auth-shell-child">secured area</div>
      </AuthShell>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in to start editing" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledTimes(1);
      expect(whoAmIMock).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Signed in as/i)).toHaveTextContent("Maya Stone");
    expect(screen.getByTestId("auth-shell-child")).toBeInTheDocument();
  });
});
