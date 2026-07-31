import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
import type {
  AdminUserPage,
  AuthResponse,
  Attachment,
  AttachmentWithTodo,
  Preference,
  QuotaUsage,
  UsageReport,
  Stats,
  Tokens,
  TwoFactorEnrolment,
  TwoFactorStatus,
  User,
} from "@/lib/types";

export function usePreferences() {
  // Only with a session. The sign-in and registration screens read preferences
  // too (for the language), and without a token this both 401-spams and, worse,
  // serves a stale account preference left in the cache from a previous
  // session — which would override the language just picked on the form.
  return useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.get<Preference>("/preferences"),
    enabled: !!tokenStore.access,
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Preference>) => api.put<Preference>("/preferences", input),
    onSuccess: (data) => qc.setQueryData(["preferences"], data),
  });
}

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: () => api.get<Stats>("/stats") });
}

// Admin
/** Server-side filters for the admin user list; empty strings mean "no filter". */
export interface UserFilters {
  q: string;
  admin: string;
  twoFactor: string;
}

export function useUsers(page: number, pageSize: number, filters: UserFilters) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.q) params.set("q", filters.q);
  if (filters.admin) params.set("admin", filters.admin);
  if (filters.twoFactor) params.set("twoFactor", filters.twoFactor);
  return useQuery({
    queryKey: ["admin-users", page, pageSize, filters.q, filters.admin, filters.twoFactor],
    queryFn: () => api.get<AdminUserPage>(`/admin/users?${params.toString()}`),
  });
}

function useAdminMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; isAdmin?: boolean }) =>
      api.post<User>("/admin/users", input),
    // Mail delivery can fail after the pending account was stored. Refresh the
    // list even on failure so the administrator can resend its invitation.
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
}

export function useResendUserInvitation() {
  return useAdminMutation((id: number) => api.post<void>(`/admin/users/${id}/invitation`, {}));
}

export function useUpdateUser() {
  return useAdminMutation(({ id, ...input }: { id: number; email?: string; password?: string; isAdmin?: boolean }) =>
    api.put<User>(`/admin/users/${id}`, input)
  );
}

export function useDeleteUser() {
  return useAdminMutation((id: number) => api.del<void>(`/admin/users/${id}`));
}

// Instance settings (admin) and public capabilities.
export interface InstanceSettings {
  allowRegister: boolean;
  /** UTC time of day the usage report rebuilds, as minutes since midnight. */
  usageReportAtMinute: number;
  usageReportTimeZone: string;
  usageReportRunAt?: string;
  updatedAt: string;
}

export interface ServerConfig {
  allowRegister: boolean;
  passkeys: boolean;
  twoFactor: boolean;
  /** Whether this instance serves the terms, privacy and cookie pages. */
  legal: boolean;
}

export function useServerConfig() {
  return useQuery({
    queryKey: ["server-config"],
    queryFn: () => api.get<ServerConfig>("/config"),
  });
}

/**
 * The build this server is running.
 *
 * Its own request rather than part of the capability probe: that one answers
 * before anyone signs in, and the release number is not something to tell an
 * unauthenticated caller. Only the shell shows it, and the shell is signed in.
 */
export function useServerVersion() {
  return useQuery({
    queryKey: ["server-version"],
    queryFn: () => api.get<{ version: string }>("/version"),
    enabled: !!tokenStore.access,
    staleTime: Infinity,
  });
}

export function useInstanceSettings() {
  return useQuery({
    queryKey: ["instance-settings"],
    queryFn: () => api.get<InstanceSettings>("/admin/settings"),
  });
}

export function useUpdateInstanceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { allowRegister?: boolean; usageReportAtMinute?: number; usageReportTimeZone?: string }) =>
      api.put<InstanceSettings>("/admin/settings", input),
    onSuccess: (data) => {
      qc.setQueryData(["instance-settings"], data);
      void qc.invalidateQueries({ queryKey: ["server-config"] });
    },
  });
}

// Passkeys
export interface Passkey {
  id: number;
  name: string;
  credentialId: string;
  createdAt: string;
  lastUsedAt?: string;
}

export function usePasskeys(enabled: boolean) {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get<Passkey[]>("/passkeys"),
    enabled,
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/passkeys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

/**
 * Changing a password revokes every session, so the server hands back a fresh
 * token pair — store it, or the caller signs themselves out.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: {
      newPassword: string;
      currentPassword?: string;
      passkeySessionId?: string;
      passkeyResponse?: unknown;
    }) => {
      const tokens = await api.post<Tokens>("/me/password", input);
      tokenStore.set(tokens);
      return tokens;
    },
  });
}

// Two-factor authentication
export function useTwoFactor(enabled: boolean) {
  return useQuery({
    queryKey: ["twofactor"],
    queryFn: () => api.get<TwoFactorStatus>("/2fa"),
    enabled,
  });
}

export function useBeginEnrolment() {
  return useMutation({
    mutationFn: () => api.post<TwoFactorEnrolment>("/2fa/enrol/begin", {}),
  });
}

export function useFinishEnrolment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrolmentId: string; code: string }) =>
      api.post<{ recoveryCodes: string[] }>("/2fa/enrol/finish", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["twofactor"] }),
  });
}

export function useRegenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { password: string }) =>
      api.post<{ recoveryCodes: string[] }>("/2fa/recovery/regenerate", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["twofactor"] }),
  });
}

export function useDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { password: string; code: string }) =>
      api.post<void>("/2fa/disable", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["twofactor"] }),
  });
}

/** Admin-only: the instance-wide usage report, served from the rebuilt table. */
export interface UsageReportQuery {
  q?: string;
  admin?: string;
  twoFactor?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}

export function useUsageReport(query: UsageReportQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && v !== "all") params.set(k, String(v));
  }
  const qs = params.toString();
  return useQuery({
    queryKey: ["usage-report", qs],
    queryFn: () => api.get<UsageReport>(`/admin/reports/usage${qs ? `?${qs}` : ""}`),
    // Keeps the previous page on screen while the next loads, so sorting and
    // paging do not blank the table.
    placeholderData: (prev) => prev,
  });
}

/** Admin-only: rebuild the report now rather than waiting for the schedule. */
export function useRunUsageReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ accounts: number }>("/admin/reports/usage/run", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-report"] }),
  });
}

/** The signed-in user's own consumption against their limits. */
export function useMyUsage() {
  return useQuery({
    queryKey: ["usage"],
    queryFn: () => api.get<QuotaUsage>("/usage"),
  });
}

/** Admin-only: one account's quota consumption. Fetched on demand, not with
 * the user list, so opening the admin page does not run seven counts per row. */
export function useUserUsage(userID: number | null) {
  return useQuery({
    queryKey: ["admin-usage", userID],
    queryFn: () => api.get<QuotaUsage>(`/admin/users/${userID}/usage`),
    enabled: userID !== null,
  });
}

/** Admin-only: clears 2FA for a user locked out of their own account. */
export function useResetUserTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/admin/users/${id}/2fa/reset`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
}

// Attachments. All mutations invalidate the whole "attachments" key prefix
// rather than just this todo's entry, since a change here also affects the
// all-attachments overview page (and, for delete, potentially nothing at all
// if the id was already gone).
export function useAttachments(todoId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["attachments", todoId],
    queryFn: () => api.get<Attachment[]>(`/todos/${todoId}/attachments`),
    enabled,
  });
}

export function useAllAttachments() {
  return useQuery({
    queryKey: ["attachments", "all"],
    queryFn: () => api.get<AttachmentWithTodo[]>("/attachments"),
  });
}

export function useUploadAttachment(todoId: number) {
  const qc = useQueryClient();
  return useMutation({
    // Multipart uploads bypass the JSON helper: the browser must set the boundary.
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/todos/${todoId}/attachments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
      return (await res.json()) as Attachment;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments"] }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments"] }),
  });
}

// downloadExport fetches the export archive with auth and saves it via a blob
// URL. The archive holds export.json alongside every uploaded file.
export async function downloadExport(): Promise<void> {
	const res = await fetch("/api/v1/export", {
    headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` },
  });
  if (!res.ok) throw new Error("export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gotracks-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Account deletion is requested from an authenticated session, then completed
// from the single-use link sent to the account's stored email address.
export function useRequestAccountDeletion() {
  return useMutation({
    mutationFn: () => api.post<void>("/me/deletion", {}),
  });
}

export function useConfirmAccountDeletion() {
  return useMutation({
    mutationFn: (input: { token: string }) =>
      api.raw("/auth/account/deletion/confirm", input),
  });
}

export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (input: { newEmail: string }) =>
      api.post<void>("/me/email-change", input),
  });
}

export function useConfirmEmailChange() {
  return useMutation({
    mutationFn: (input: { token: string }) =>
      api.raw("/auth/email/change/confirm", input),
  });
}

// Email verification and password reset. All pre-session, so they use api.raw.
export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) => api.raw("/auth/password/forgot", input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      api.raw("/auth/password/reset", input),
  });
}

export function useAcceptInvitation() {
  return useMutation({
    // acceptLegal is the tick from the registration form; the server refuses
    // the invitation without it when the instance serves the documents.
    mutationFn: (input: { token: string; newPassword: string; acceptLegal: boolean }) =>
      api.raw("/auth/invitation/accept", input) as Promise<AuthResponse>,
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (input: { token: string }) => api.raw("/auth/email/verify", input),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (input: { email: string }) => api.raw("/auth/email/resend", input),
  });
}

// Runtime log level (admin). Raising it takes effect with no restart and
// reverts after the chosen window.
export interface LogLevelState {
  level: string;
  baseline: string;
  overrideUntil: string | null;
}

export function useLogLevel() {
  return useQuery({
    queryKey: ["log-level"],
    queryFn: () => api.get<LogLevelState>("/admin/log-level"),
  });
}

export function useSetLogLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { level: string; durationMinutes: number }) =>
      api.put<LogLevelState>("/admin/log-level", input),
    onSuccess: (data) => qc.setQueryData(["log-level"], data),
  });
}
