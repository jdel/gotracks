import { useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, setOnLogout } from "./api";
import { loginWithPasskey } from "./passkeys";
import type { AuthResponse, LoginResponse, User } from "./types";
import { isTwoFactorChallenge } from "./types";
import { AuthContext } from "./auth";
import { detectTimeZone } from "./timezone";

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
        // Deliberately does not clear the tokens. A session the server has
        // actually refused is cleared by the transport, which is the one place
        // that knows what a 401 means and has already tried the refresh. What
        // reaches here instead is a 500, a proxy restarting mid-deploy, or no
        // network at all — none of which say anything about the credentials.
        // Throwing them away for those meant a five-second outage, or a reload
        // while offline, signed the user out for good: the tokens live only in
        // this browser, so deleting them loses a session the server would still
        // have honoured.
        .catch(() => {})
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
    // enrollment rather than needing an authenticated preference call. The zone
    // is validated so a placeholder value never reaches the server.
    const timeZone = detectTimeZone();
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
