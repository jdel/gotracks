import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useVerifyEmail } from "@/hooks/useSettings";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/AuthLayout";
import { useT } from "@/lib/i18n";

/** Landing page for the link in a verification email. */
export function VerifyEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const verify = useVerifyEmail();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // Strict mode mounts effects twice in development; the token is single-use,
  // so a second call would report the link as already spent.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify
      .mutateAsync({ token })
      .then(() => setDone(true))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : t("verify.error")),
      );
  }, [token, verify, t]);

  return (
    <AuthLayout title={t("verify.title")}>
      {!token && <p className="text-sm font-medium text-danger">{t("verify.incomplete")}</p>}
      {token && !done && !error && <p className="text-sm font-medium text-ink-3">{t("verify.confirming")}</p>}
      {done && <p className="text-sm font-medium text-ink dark:text-ink-dark">{t("verify.done")}</p>}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button asChild className="w-full">
        <Link to="/login">{t("verify.goSignIn")}</Link>
      </Button>
    </AuthLayout>
  );
}
