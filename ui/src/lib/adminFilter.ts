import type { AdminUser } from "@/lib/types";

/** A filter that can require a flag, forbid it, or ignore it. */
export type TriState = "all" | "on" | "off";

/** Cycles a tri-state filter: all → on → off → all. */
export function nextTriState(current: TriState): TriState {
  switch (current) {
    case "all":
      return "on";
    case "on":
      return "off";
    default:
      return "all";
  }
}

function matchesTriState(value: boolean, filter: TriState): boolean {
  return filter === "all" || (filter === "on") === value;
}

export interface AdminFilters {
  query: string;
  admin: TriState;
  twoFactor: TriState;
}

/**
 * filterUsers narrows the admin list. The query matches the email address,
 * case-insensitively and on substrings, so a partial address finds an account.
 */
export function filterUsers(users: AdminUser[], filters: AdminFilters): AdminUser[] {
  const query = filters.query.trim().toLowerCase();
  return users.filter((u) => {
    if (query) {
      const haystack = u.email.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return (
      matchesTriState(u.isAdmin, filters.admin) &&
      matchesTriState(u.twoFactorEnabled, filters.twoFactor)
    );
  });
}
