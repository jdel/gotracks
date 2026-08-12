import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RecurringTodo } from "@/lib/types";

export function useRecurring(state?: string) {
  return useQuery({
    queryKey: ["recurring", state ?? "all"],
    queryFn: () => api.get<RecurringTodo[]>(`/recurring${state ? `?state=${state}` : ""}`),
  });
}

export interface RecurringInput {
  contextId?: number;
  projectId?: number;
  /** Names create the context/project server-side when they do not exist yet. */
  contextName?: string;
  projectName?: string;
  description?: string;
  state?: string;
  period?: string;
  everyN?: number;
  weekdays?: string;
  dayOfMonth?: number;
  monthOfYear?: number;
  showFromDays?: number;
  startFrom?: string;
  endDate?: string;
}

function useRecurringMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useCreateRecurring() {
  return useRecurringMutation((input: RecurringInput) =>
    api.post<RecurringTodo>("/recurring", input)
  );
}

export function useUpdateRecurring() {
  return useRecurringMutation(({ id, ...input }: RecurringInput & { id: number }) =>
    api.put<RecurringTodo>(`/recurring/${id}`, input)
  );
}

export function useDeleteRecurring() {
  return useRecurringMutation((id: number) => api.del<void>(`/recurring/${id}`));
}
