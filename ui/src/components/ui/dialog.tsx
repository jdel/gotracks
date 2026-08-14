import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";


const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/60 animate-in fade-in-0", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { overlayClassName?: string }
>(({ className, overlayClassName, children, ...props }, ref) => {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Mobile: full-screen sheet. Desktop (sm+): a centred card.
          "fixed inset-0 z-50 h-dvh w-screen overflow-y-auto border bg-background p-6 shadow-lg animate-in fade-in-0",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:w-full sm:max-w-md",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={t("common.close")}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * FormScreenSurface is a dialog that fills the screen. The panel the add and
 * edit forms are drawn on for a phone, where a bottom sheet put half the form
 * behind the keyboard. Deliberately not keyboard-aware: it does not need to be,
 * because it is anchored to the top rather than the bottom — the field being
 * typed into stays where it is and the body scrolls under the keyboard.
 */
const FormScreenSurface = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 h-dvh w-screen overflow-y-auto bg-card px-4 pt-3.5",
        // The safe area at the foot, so the last control is not under the home
        // indicator, and room to scroll the end of the form clear of a keyboard.
        "pb-[max(2rem,env(safe-area-inset-bottom))]",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4",
        "dark:bg-card-dark",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
FormScreenSurface.displayName = "FormScreenSurface";

/**
 * SheetSurface is a dialog anchored to the bottom of the screen: the panel a
 * bottom sheet is drawn on. It carries no handle, header or gesture — the Sheet
 * primitive in components/primitives.tsx puts those on top of it, and is what
 * the application uses. Same dialog underneath as the modals, so the focus
 * trap, escape handling and scroll lock are the same too.
 */
const SheetSurface = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Tapping the dimmed area behind the sheet. */
    onOverlayClick?: () => void;
  }
>(({ className, children, onOverlayClick, style, ...props }, ref) => {
  const keyboard = useKeyboardInset();
  return (
  <DialogPrimitive.Portal>
    <DialogOverlay onClick={onOverlayClick} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] touch-pan-y overflow-y-auto rounded-t-sheet",
        "bg-card px-4 pt-3.5 shadow-sheet dark:bg-card-dark",
        "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        className,
      )}
      // Lifted to sit on top of the keyboard rather than behind it, and capped
      // to the strip that is left, so a long form scrolls inside what can
      // actually be seen. `bottom` rather than a transform on purpose: the pull
      // gesture owns the transform, and two writers of one property is a bug
      // waiting for the day both are active.
      style={
        keyboard > 0
          ? { bottom: keyboard, maxHeight: `calc(100dvh - ${keyboard}px)`, ...style }
          : style
      }
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
  );
});
SheetSurface.displayName = "SheetSurface";

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  FormScreenSurface,
  DialogTrigger,
  DialogClose,
  DialogContent,
  SheetSurface,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
