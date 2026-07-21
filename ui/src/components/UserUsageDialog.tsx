import { useUserUsage } from "@/hooks/useSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UsageBars } from "@/components/UsageBars";
import type { AdminUser } from "@/lib/types";
import { useT } from "@/lib/i18n";

/** Shows one account's quota consumption, opened from the admin user list. */
export function UserUsageDialog({
  user,
  onOpenChange,
}: {
  user: AdminUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { data, isLoading, error } = useUserUsage(user?.id ?? null);

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      {/* Full-screen: usage is worth reading at size rather than in a small
          centred card. The utilities here override the default dialog's
          centred, max-w-md box. */}
      <DialogContent className="inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none">
        <div className="mx-auto w-full max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("usage.title")}</DialogTitle>
            <DialogDescription>{user?.email}</DialogDescription>
          </DialogHeader>

          {isLoading && <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
          {error && <p className="mt-4 text-sm text-destructive">{t("usage.loadError")}</p>}
          {data && (
            <div className="mt-6">
              <UsageBars usage={data} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
