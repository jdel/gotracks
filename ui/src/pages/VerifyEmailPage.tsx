import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useVerifyEmail } from "@/hooks/useSettings";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("verify.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && <p className="text-sm text-destructive">{t("verify.incomplete")}</p>}
          {token && !done && !error && <p className="text-sm text-muted-foreground">{t("verify.confirming")}</p>}
          {done && <p className="text-sm">{t("verify.done")}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button asChild className="w-full">
            <Link to="/login">{t("verify.goSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
