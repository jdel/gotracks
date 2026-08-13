import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { UndoProvider } from "@/lib/undoable";
import { setViewport } from "@/test/viewport";

/**
 * Renders a component with what the application gives it.
 *
 * `new QueryClient` appeared thirty times across the suite, most of them
 * forgetting `retry: false` — which turns a test that should fail in
 * milliseconds into one that fails after three retries and a backoff, or worse,
 * passes because the retry succeeded against a stub that had moved on.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    viewport,
    undo = false,
  }: {
    route?: string;
    /** Which presentation this test is about. Omit only if it cannot matter. */
    viewport?: "phone" | "desktop";
    /** Needed by anything that completes or deletes: both go through the undo toast. */
    undo?: boolean;
  } = {},
) {
  if (viewport) setViewport(viewport);
  const client = new QueryClient({
    defaultOptions: {
      // A test asserts one attempt against one stubbed answer. Retries make a
      // failure slow and a success ambiguous.
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {undo ? <UndoProvider>{children}</UndoProvider> : children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { client, ...render(ui, { wrapper }) };
}
