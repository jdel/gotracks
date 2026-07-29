import { Navigate } from "react-router";
import type { ReactNode } from "react";
import { useServerConfig } from "@/hooks/useSettings";

/**
 * Guards the routes that only exist where the instance serves legal pages.
 *
 * With them off the API route is not registered, so rendering the page would
 * show an empty document rather than sending the address somewhere real.
 * Renders nothing while the capability is still unknown, so a slow reply never
 * bounces somebody off a page they are entitled to.
 */
export function RequireLegal({ children }: { children: ReactNode }) {
  const { data, isPending } = useServerConfig();
  if (isPending) return null;
  if (!data?.legal) return <Navigate to="/" replace />;
  return <>{children}</>;
}
