import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { useAuth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Layout", () => ({ Layout: () => <div>Application shell</div> }));
// The signed-in tree asks the server whether this account owes agreement to a
// policy, so these routes need a query client the way the real application has.
vi.mock("@/hooks/useLegal", () => ({
  useLegalPending: () => ({ data: [] }),
  useLegalDocuments: () => ({ data: [] }),
  useAcceptLegal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 1,
      login: "user0001",
      email: "user0001@example.com",
      isAdmin: false,
      createdAt: "",
      updatedAt: "",
    },
    ready: true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

describe("authenticated entry routes", () => {
  it.each(["/login", "/register"])("redirects %s to the application", async (route) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Application shell")).toBeDefined();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });
});
