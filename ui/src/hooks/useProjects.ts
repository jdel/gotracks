import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Note, Project, ProjectState, Tag } from "@/lib/types";

export function useProjects(state?: ProjectState) {
  return useQuery({
    queryKey: ["projects", state ?? "all"],
    queryFn: () => api.get<Project[]>(`/projects${state ? `?state=${state}` : ""}`),
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
  });
}

function useProjectMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

export interface ProjectInput {
  name?: string;
  description?: string;
  state?: ProjectState;
  defaultContextId?: number;
}

export function useCreateProject() {
  return useProjectMutation((input: ProjectInput) => api.post<Project>("/projects", input));
}

export function useUpdateProject() {
  return useProjectMutation(({ id, ...input }: ProjectInput & { id: number }) =>
    api.put<Project>(`/projects/${id}`, input)
  );
}

export function useDeleteProject() {
  // Without deleteNotes, the server refuses a project that still holds notes
  // and answers with the count so the caller can ask before choosing.
  return useProjectMutation(({ id, deleteNotes }: { id: number; deleteNotes?: boolean }) =>
    api.del<void>(`/projects/${id}${deleteNotes != null ? `?deleteNotes=${deleteNotes}` : ""}`)
  );
}

export function useReviewProject() {
  return useProjectMutation((id: number) => api.post<Project>(`/projects/${id}/review`));
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
}

export function useNotes(projectId?: number) {
  return useQuery({
    queryKey: ["notes", projectId ?? "all"],
    queryFn: () =>
      api.get<Note[]>(`/notes${projectId != null ? `?projectId=${projectId}` : ""}`),
  });
}

export interface NoteInput {
  body?: string;
  projectId?: number;
  /** An unknown name creates the project on the fly, same as "#project" in a todo. */
  projectName?: string;
  clearProject?: boolean;
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteInput) => api.post<Note>("/notes", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      // A new "#project" reference may have created the project.
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: NoteInput & { id: number }) =>
      api.put<Note>(`/notes/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}
