import { useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, setOnLogout } from "./api";
import { loginWithPasskey } from "./passkeys";
import type { AuthResponse, LoginResponse, User } from "./types";
import { isTwoFactorChallenge } from "./types";
import { AuthContext } from "./auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Ready immediately when there is no session to restore; when there is one,
  // the effect below fetches the user and flips this in its async callback.
  // Initialising it here (rather than setting it in the effect) keeps the
  // effect free of a synchronous setState (react-hooks/set-state-in-effect).
  const [ready, setReady] = useState(() => !tokenStore.refresh);

  useEffect(() => {
    setOnLogout(() => setUser(null));
    // Restore session: if a refresh token exists, fetch the current user.
    if (tokenStore.refresh) {
      api
        .get<User>("/me")
        .then(setUser)
        .catch(() => tokenStore.clear())
        .finally(() => setReady(true));
    }
  }, []);

  async function login(email: string, password: string) {
    const res = await api.raw("/auth/login", { email, password }) as LoginResponse;
    // A challenge means the password was right but the sign-in is unfinished:
    // there is nothing to store yet. The id stays in component state only.
    if (isTwoFactorChallenge(res)) {
      return res.twoFactor;
    }
    tokenStore.set(res.tokens);
    setUser(res.user);
    return null;
  }

  async function completeTwoFactor(challengeId: string, code: string) {
    const res = await api.raw("/auth/2fa/verify", { challengeId, code }) as AuthResponse;
    tokenStore.set(res.tokens);
    setUser(res.user);
  }

  async function register(email: string, locale?: string) {
    // The language is chosen before the account exists, so it travels with the
    // enrollment rather than needing an authenticated preference call.
    let timeZone = "";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* Intl unavailable — the server keeps UTC. */
    }
    await api.raw("/auth/register", { email, locale, timeZone });
  }

  async function signInWithPasskey(email: string) {
    const res = await loginWithPasskey(email);
    tokenStore.set(res.tokens);
    setUser(res.user);
  }

  function establishSession(response: AuthResponse) {
    tokenStore.set(response.tokens);
    setUser(response.user);
  }

  function logout() {
    const refreshToken = tokenStore.refresh;
    if (refreshToken) void api.raw("/auth/logout", { refreshToken }).catch(() => {});
    tokenStore.clear();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, ready, login, completeTwoFactor, register, establishSession, signInWithPasskey, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
