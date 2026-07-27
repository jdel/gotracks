import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterPage } from "./RegisterPage";
import { AuthProvider } from "@/lib/AuthProvider";
import { I18nProvider } from "@/lib/I18nProvider";

let registered: Array<Record<string, unknown>>;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/auth/register")) {
    registered.push(JSON.parse(String(init?.body ?? "{}")));
    return Promise.resolve({ ok: true, status: 204 } as Response);
  }
  if (url.includes("/config")) {
    return Promise.resolve(jsonResponse({
      allowRegister: true, passkeys: false, twoFactor: false,
    }));
  }
  if (url.includes("/me")) return Promise.resolve(jsonResponse({}, 401));
  if (url.includes("/preferences")) return Promise.resolve(jsonResponse({}, 401));
  return Promise.resolve(jsonResponse({}, 404));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <I18nProvider>
            <RegisterPage />
          </I18nProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registered = [];
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("registration language", () => {
  // The picker lives on the sign-in page and persists on the device; the
  // registration form inherits that choice and sends it with the signup.
  it("sends the device locale with the signup", async () => {
    const user = userEvent.setup();
    localStorage.setItem("gt.locale", "fr");
    renderPage();

    // Inherited: the form renders in French.
    expect(screen.getByText("Vous avez déjà un compte ?")).toBeDefined();

    await user.type(screen.getByLabelText("Adresse e-mail"), "a@b.com");
    await user.click(screen.getByRole("button", { name: /Créer un compte/ }));

    expect(registered).toHaveLength(1);
    expect(registered[0]).not.toHaveProperty("password");
    expect(registered[0].locale).toBe("fr");
    expect(await screen.findByText(/Consultez votre boîte/)).toBeDefined();
  });

  it("registers the first user with no secret", async () => {
    // The empty-instance signal is folded into allowRegister; the form asks for
    // an email only, and the first account becomes the administrator.
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "root@example.com");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(registered).toHaveLength(1);
    expect(registered[0].email).toBe("root@example.com");
    expect(registered[0]).not.toHaveProperty("bootstrapSecret");
  });
});
