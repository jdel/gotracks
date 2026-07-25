import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Session {
  id: string;
  startedAt: string;
  lastUsed: string;
  ip?: string;
  userAgent?: string;
  current: boolean;
}

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/me/sessions"),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/me/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del("/me/sessions"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}
