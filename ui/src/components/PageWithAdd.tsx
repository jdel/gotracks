import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Fills the screen on a phone, a centred card at sm and up. Shared so every
// full-screen add modal matches without repeating the class list.
export const FULLSCREEN_DIALOG_CLASS =
  "inset-0 left-0 top-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 " +
  "space-y-4 overflow-y-auto rounded-none border-0 sm:inset-auto sm:left-1/2 sm:top-1/2 " +
  "sm:h-auto sm:max-h-[85dvh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 " +
  "sm:rounded-lg sm:border";

/**
 * A list page whose add form is permanent on desktop and, on a phone, tucked
 * behind a + in the header that opens the form full screen — the pattern the
 * actions view established, factored out so the collection pages share it.
 *
 * `renderForm` is given a close callback to call after a successful add, so the
 * mobile sheet dismisses itself; the desktop copy passes a no-op.
 */
export function PageWithAdd({
  title,
  subtitle,
  addLabel,
  widthClass = "max-w-3xl",
  renderForm,
  children,
}: {
  title: string;
  subtitle?: string;
  addLabel: string;
  widthClass?: string;
  renderForm: (onAdded: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("mx-auto w-full space-y-6", widthClass)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <IconButton
          variant="outline"
          className="shrink-0 md:hidden"
          label={addLabel}
          onClick={() => setOpen(true)}
        >
          <Plus />
        </IconButton>
      </div>

      <div className="hidden md:block">{renderForm(() => {})}</div>

      {children}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={FULLSCREEN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>{addLabel}</DialogTitle>
          </DialogHeader>
          {renderForm(() => setOpen(false))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
