import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen. Say what is destroyed, and that it cannot be undone. */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  /**
   * Why the last attempt did not finish. Shown inside the dialog, because a
   * dialog that stays open after a failure has to say what happened — and the
   * user is still standing in front of the decision.
   */
  error?: ReactNode;
  onConfirm: () => void;
}

/**
 * ConfirmDialog gates an irreversible action behind an explicit confirmation.
 *
 * The cancel button holds focus when the dialog opens, so a stray Enter closes
 * it rather than confirming the thing it is warning about.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT();
  const confirm = confirmLabel ?? t("common.delete");
  const cancel = cancelLabel ?? t("common.cancel");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-2">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} autoFocus>
            {cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? t("common.working") : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
