import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useConfirmEmailChange } from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/primitives";
import { AuthLayout } from "@/components/AuthLayout";

/** Landing page that proves ownership of a requested new email address. */
export function ChangeEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const confirm = useConfirmEmailChange();
  const { logout } = useAuth();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    confirm
      .mutateAsync({ token })
      .then(() => {
        logout();
        setDone(true);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t("emailChange.confirmError")));
  }, [confirm, logout, t, token]);

  return (
    <AuthLayout title={t("emailChange.confirmTitle")}>
      {!token && <p className="text-sm font-medium text-danger">{t("emailChange.incomplete")}</p>}
      {token && !done && !error && <p className="text-sm font-medium text-ink-3">{t("emailChange.confirming")}</p>}
      {done && <p className="text-sm font-medium text-ink dark:text-ink-dark">{t("emailChange.done")}</p>}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button asChild className="w-full">
        <Link to="/login">{t("auth.signIn")}</Link>
      </Button>
    </AuthLayout>
  );
}
