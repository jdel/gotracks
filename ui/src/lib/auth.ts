import { createContext, useContext } from "react";
import type { AuthResponse, TwoFactorChallenge, User } from "./types";

export interface AuthContextValue {
  user: User | null;
  ready: boolean;
  /**
   * Returns a challenge when the account has two-factor enabled, in which case
   * no session exists yet and completeTwoFactor must be called next.
   */
  login: (email: string, password: string) => Promise<TwoFactorChallenge | null>;
  /** completeTwoFactor finishes a sign-in that stopped at the second factor. */
  completeTwoFactor: (challengeId: string, code: string) => Promise<void>;
  register: (email: string, locale?: string) => Promise<void>;
  /** completeSSO stores tokens handed back by the OIDC callback. */
  completeSSO: (accessToken: string, refreshToken: string) => Promise<void>;
  /** establishSession stores a complete authenticated API response. */
  establishSession: (response: AuthResponse) => void;
  /** signInWithPasskey runs the WebAuthn ceremony for the named account. */
  signInWithPasskey: (email: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
