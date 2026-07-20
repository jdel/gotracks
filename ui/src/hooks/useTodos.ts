import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Todo } from "@/lib/types";

export interface TodoFilter {
  state?: string;
  contextId?: number;
  projectId?: number;
  tag?: string;
  starred?: boolean;
}

function toQuery(f: TodoFilter): string {
  const p = new URLSearchParams();
  if (f.state) p.set("state", f.state);
  if (f.contextId != null) p.set("contextId", String(f.contextId));
  if (f.projectId != null) p.set("projectId", String(f.projectId));
  if (f.tag) p.set("tag", f.tag);
  if (f.starred) p.set("starred", "true");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function useTodos(filter: TodoFilter = {}) {
  return useQuery({
    queryKey: ["todos", filter],
    queryFn: () => api.get<Todo[]>(`/todos${toQuery(filter)}`),
  });
}

// Every mutation refreshes the todo lists plus everything a todo can change:
// project open-counts, the tag list, and — because "@name"/"#name" create them
// on the fly — the context and project lists themselves. Without the contexts
// refresh, an action filed under a brand-new context has no section to appear
// in and stays invisible until a page reload.
//
// The invalidation is awaited so the mutation stays pending until the refetch
// lands, which keeps the UI from briefly showing stale data.
function useTodoMutation<TData, TVars>(
  fn: (vars: TVars) => Promise<TData>,
  extraKeys: string[] = [],
) {
  const qc = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["todos"] }),
        qc.invalidateQueries({ queryKey: ["contexts"] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["tags"] }),
        ...extraKeys.map((key) => qc.invalidateQueries({ queryKey: [key] })),
      ]);
    },
  });
}

export interface TodoInput {
  contextId?: number;
  projectId?: number | null;
  /** Names create the context/project server-side when they do not exist yet. */
  contextName?: string;
  projectName?: string;
  description?: string;
  notes?: string;
  due?: string;
  showFrom?: string;
  starred?: boolean;
  tags?: string[];
}

export function useCreateTodo() {
  return useTodoMutation((input: TodoInput) => api.post<Todo>("/todos", input));
}

export function useUpdateTodo() {
  return useTodoMutation(({ id, ...input }: TodoInput & { id: number }) =>
    api.put<Todo>(`/todos/${id}`, input)
  );
}

export function useCompleteTodo() {
  // Completing may auto-delete the todo's attachments server-side (an opt-in
  // preference), so the attachments cache needs invalidating too.
  return useTodoMutation((id: number) => api.post<Todo>(`/todos/${id}/complete`), ["attachments"]);
}

export function useReactivateTodo() {
  return useTodoMutation((id: number) => api.post<Todo>(`/todos/${id}/reactivate`));
}

export function useDeleteTodo() {
  return useTodoMutation((id: number) => api.del<void>(`/todos/${id}`));
}
