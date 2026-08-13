import { Navigate } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Guards the sections that belong to administrators.
 *
 * The navigation already hides these links, but hiding a link is discovery, not
 * access: a typed address, an old bookmark or a pasted link mounted the page
 * anyway, which fired its admin queries and filled the screen with the refusals
 * the API correctly returned. The API is the security boundary and always was —
 * this is about the interface not offering a room it will not let you into.
 *
 * Sends them home rather than showing a forbidden page: administrator is a
 * property of the account and nothing in the interface can request it, so there
 * is no door to explain. `replace` keeps Back from bouncing between the two.
 *
 * `ready` is handled although `RequireAuth` has already waited for it — relying
 * on the ordering of two guards is an assumption that survives right up until
 * someone reorders them.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
