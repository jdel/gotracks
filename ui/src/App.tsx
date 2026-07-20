import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { ContextsPage } from "@/pages/ContextsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { TicklerPage, StarredPage, DonePage, TagsPage } from "@/pages/ListPages";
import { RecurringPage } from "@/pages/RecurringPage";
import { StatsPage } from "@/pages/StatsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AttachmentsPage } from "@/pages/AttachmentsPage";
import { NotesPage } from "@/pages/NotesPage";
import type { ReactNode } from "react";


function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// WhenSignedOut renders the login/register form, or — when a session already
// exists — an explicit way to switch accounts.
//
// It must not redirect: registering a new account replaces the stored session,
// so silently bouncing away from /login left the previous user (typically the
// admin) with no route back to the sign-in form.
function WhenSignedOut({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useAuth();
  if (!ready) return null;
  if (!user) return <>{children}</>;

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center">
        <p className="text-sm">
          Signed in as <span className="font-medium">{user.email}</span>.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline">
            <Link to="/">Go to your actions</Link>
          </Button>
          <Button onClick={logout}>Sign out to use another account</Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<WhenSignedOut><LoginPage /></WhenSignedOut>} />
      <Route path="/register" element={<WhenSignedOut><RegisterPage /></WhenSignedOut>} />
      {/* Landing pages for mailed links. Reachable while signed in too: the
          link may be opened in a browser that already has a session. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
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
        <Route path="/reports" element={<ReportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
