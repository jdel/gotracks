import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { AcceptInvitationPage, ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { DeleteAccountPage } from "@/pages/DeleteAccountPage";
import { ChangeEmailPage } from "@/pages/ChangeEmailPage";
import { ContextsPage } from "@/pages/ContextsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { TicklerPage, StarredPage, DonePage, TagsPage } from "@/pages/ListPages";
import { RecurringPage } from "@/pages/RecurringPage";
import { StatsPage } from "@/pages/StatsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { ServerPage } from "@/pages/ServerPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AttachmentsPage } from "@/pages/AttachmentsPage";
import { NotesPage } from "@/pages/NotesPage";
import { TermsPage, PrivacyPage, CookiesPage } from "@/pages/LegalPage";
import { LegalAdminPage } from "@/pages/LegalAdminPage";
import { AuditPage } from "@/pages/AuditPage";
import { RequireLegal } from "@/components/RequireLegal";
import type { ReactNode } from "react";


function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireSignedOut({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <>{children}</>;
  return <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<RequireSignedOut><LoginPage /></RequireSignedOut>} />
      <Route path="/register" element={<RequireSignedOut><RegisterPage /></RequireSignedOut>} />
      {/* Landing pages for mailed links. Reachable while signed in too: the
          link may be opened in a browser that already has a session. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/delete-account" element={<DeleteAccountPage />} />
      <Route path="/change-email" element={<ChangeEmailPage />} />
      {/* Public: they have to be readable before an account exists, because
          creating one is agreeing to them. */}
      <Route path="/terms" element={<RequireLegal><TermsPage /></RequireLegal>} />
      <Route path="/privacy" element={<RequireLegal><PrivacyPage /></RequireLegal>} />
      <Route path="/cookies" element={<RequireLegal><CookiesPage /></RequireLegal>} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/contexts" element={<ContextsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/tickler" element={<TicklerPage />} />
        <Route path="/starred" element={<StarredPage />} />
        <Route path="/done" element={<DonePage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/attachments" element={<AttachmentsPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/settings" element={<ServerPage />} />
        <Route path="/legal" element={<RequireLegal><LegalAdminPage /></RequireLegal>} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
