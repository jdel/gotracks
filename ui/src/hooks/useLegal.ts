import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useServerConfig } from "@/hooks/useSettings";
import type { LegalDocument, LegalEditor, LegalKind } from "@/lib/types";

/**
 * Whether this instance serves the legal pages at all.
 *
 * Every legal query waits on this. With the pages off the routes are not
 * registered, so asking would be a guaranteed 404 on every load.
 */
function useLegalEnabled() {
  const { data } = useServerConfig();
  return data?.legal === true;
}

/**
 * The documents are public: they have to render before an account exists,
 * because agreeing to them is part of creating one.
 */
export function useLegalDocuments() {
  const enabled = useLegalEnabled();
  return useQuery({
    queryKey: ["legal", "documents"],
    queryFn: () => api.get<LegalDocument[]>("/legal"),
    enabled,
    staleTime: 60_000,
  });
}

/** The operator's view: stored replacements alongside the shipped text. */
export function useLegalEditor() {
  const enabled = useLegalEnabled();
  return useQuery({
    queryKey: ["legal", "editor"],
    queryFn: () => api.get<LegalEditor>("/admin/legal"),
    enabled,
  });
}

export function useSaveLegalDocument() {
  const qc = useQueryClient();
  return useMutation({
    // An empty body resets to the shipped text rather than publishing a blank
    // document, which is what the server does with it too.
    mutationFn: (input: { locale: string; kind: LegalKind; body: string }) =>
      api.put(`/admin/legal/${input.locale}/${input.kind}`, { body: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legal"] }),
  });
}

export function useResetLegalDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { locale: string; kind: LegalKind }) =>
      api.del(`/admin/legal/${input.locale}/${input.kind}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legal"] }),
  });
}
