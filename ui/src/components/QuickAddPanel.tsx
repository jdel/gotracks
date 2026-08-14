import { FormScreen } from "@/components/primitives";
import { QuickAdd } from "@/components/QuickAdd";
import { useT } from "@/lib/i18n";

// The FAB target on mobile. Reuses the existing single-line parser; QuickAdd
// clears its input on a successful add and the panel stays open, so Enter adds
// and keeps focus for the next capture. Escape closes and returns focus to the
// FAB.
//
// Full screen rather than a bottom sheet: the form is seven fields, and a sheet
// puts everything below the caret behind the keyboard.
export function QuickAddPanel({
  open,
  onClose,
  defaultContextId,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  defaultContextId?: number;
  defaultProjectId?: number;
}) {
  const t = useT();
  return (
    <FormScreen
      open={open}
      onClose={onClose}
      title={t("home.addAction")}
      closeLabel={t("common.close")}
    >
      <QuickAdd defaultContextId={defaultContextId} defaultProjectId={defaultProjectId} />
    </FormScreen>
  );
}
