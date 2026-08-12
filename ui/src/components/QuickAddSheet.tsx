import { Sheet } from "@/components/primitives";
import { QuickAdd } from "@/components/QuickAdd";
import { useT } from "@/lib/i18n";

// The FAB target on mobile. Reuses the existing single-line parser; QuickAdd
// clears its input on a successful add and the sheet stays open, so Enter adds
// and keeps focus for the next capture. Escape (handled by Sheet) closes and
// returns focus to the FAB.
export function QuickAddSheet({
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
    <Sheet open={open} onClose={onClose} title={t("home.addAction")}>
      <QuickAdd defaultContextId={defaultContextId} defaultProjectId={defaultProjectId} />
    </Sheet>
  );
}
