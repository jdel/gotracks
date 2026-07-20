/**
 * Password policy, mirrored from internal/auth/password_policy.go so the user
 * gets feedback as they type. The server is the authority and re-checks every
 * password it is given; if you change a rule, change it in both places.
 */

export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordRule {
  id: string;
  /** i18n key for the rule; {min} is filled for the length rule. */
  labelKey: string;
  /** Params for the label key, when it interpolates. */
  labelParams?: Record<string, string | number>;
  met: boolean;
}

/** Matches Go's unicode.IsPunct | unicode.IsSymbol closely enough for hints. */
const SYMBOL = /[^\p{L}\p{N}\s]/u;

export function passwordRules(password: string): PasswordRule[] {
  // Spread, so characters outside the basic plane count once rather than twice.
  const length = [...password].length;
  return [
    { id: "length", labelKey: "passwordRule.length", labelParams: { min: MIN_PASSWORD_LENGTH }, met: length >= MIN_PASSWORD_LENGTH },
    { id: "upper", labelKey: "passwordRule.upper", met: /\p{Lu}/u.test(password) },
    { id: "lower", labelKey: "passwordRule.lower", met: /\p{Ll}/u.test(password) },
    { id: "digit", labelKey: "passwordRule.digit", met: /\p{Nd}/u.test(password) },
    { id: "symbol", labelKey: "passwordRule.symbol", met: SYMBOL.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return passwordRules(password).every((r) => r.met);
}

/**
 * Login name rules, mirrored from internal/auth/login.go. The server is the
 * authority; this is here so the form can say what is wrong before submitting.
 */
export const MIN_LOGIN_LENGTH = 3;
export const MAX_LOGIN_LENGTH = 32;

const LOGIN_PATTERN = /^[a-z0-9_-]+$/;

/** Canonical form: trimmed and lower-cased, matching the server. */
export function normaliseLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function isLoginValid(login: string): boolean {
  const l = normaliseLogin(login);
  return l.length >= MIN_LOGIN_LENGTH && l.length <= MAX_LOGIN_LENGTH && LOGIN_PATTERN.test(l);
}
