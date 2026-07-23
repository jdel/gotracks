import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useConfirmAccountDeletion } from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Final, emailed confirmation page for permanent account deletion. */
export function DeleteAccountPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const confirmDeletion = useConfirmAccountDeletion();
  const { logout } = useAuth();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setError("");
    try {
      await confirmDeletion.mutateAsync({ token });
      logout();
      setDone(true);
    } catch (err) {
      setError(apiMessage(err, t("accountDeletion.confirmError")));
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md border-destructive/60">
        <CardHeader>
          <CardTitle className="text-xl text-destructive">{t("accountDeletion.finalTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!token ? (
            <p className="text-sm text-destructive">{t("accountDeletion.incomplete")}</p>
          ) : done ? (
            <div className="space-y-4">
              <p className="text-sm">{t("accountDeletion.deleted")}</p>
              <Button asChild className="w-full">
                <Link to="/login">{t("accountDeletion.returnToSignIn")}</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="font-medium text-destructive">{t("accountDeletion.warning")}</p>
                <p className="text-sm text-muted-foreground">{t("accountDeletion.finalDescription")}</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                variant="destructive"
                size="lg"
                className="w-full"
                disabled={confirmDeletion.isPending}
                onClick={() => void deleteAccount()}
              >
                <Trash2 />
                {confirmDeletion.isPending
                  ? t("common.working")
                  : t("accountDeletion.finalButton")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
