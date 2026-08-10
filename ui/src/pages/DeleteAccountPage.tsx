import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useConfirmAccountDeletion } from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/AuthLayout";

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
    <AuthLayout danger title={t("accountDeletion.finalTitle")}>
      {!token ? (
        <p className="text-sm font-medium text-danger">{t("accountDeletion.incomplete")}</p>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink dark:text-ink-dark">{t("accountDeletion.deleted")}</p>
          <Button asChild className="w-full">
            <Link to="/login">{t("accountDeletion.returnToSignIn")}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="font-bold text-danger">{t("accountDeletion.warning")}</p>
            <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("accountDeletion.finalDescription")}</p>
          </div>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            disabled={confirmDeletion.isPending}
            onClick={() => void deleteAccount()}
          >
            <Trash2 />
            {confirmDeletion.isPending ? t("common.working") : t("accountDeletion.finalButton")}
          </Button>
        </>
      )}
    </AuthLayout>
  );
}
