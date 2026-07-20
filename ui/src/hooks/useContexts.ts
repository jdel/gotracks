import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Context, ContextState } from "@/lib/types";

const KEY = ["contexts"];

export function useContexts() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<Context[]>("/contexts"),
  });
}

export function useCreateContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; state?: ContextState }) =>
      api.post<Context>("/contexts", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; name?: string; state?: ContextState }) =>
      api.put<Context>(`/contexts/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteContext() {
  const qc = useQueryClient();
  return useMutation({
    // Without force the server refuses a context that still holds actions, and
    // answers with the counts so the caller can warn before destroying them.
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      api.del<void>(`/contexts/${id}${force ? "?force=true" : ""}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      // A forced delete takes actions and patterns with it.
      void qc.invalidateQueries({ queryKey: ["todos"] });
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
