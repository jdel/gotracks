import * as React from "react";
import { Button } from "@/components/primitives";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>;

interface IconButtonProps extends Omit<ButtonProps, "size" | "title"> {
  /**
   * What the button does, shown on hover and focus and read by screen readers.
   * Required: an icon on its own says nothing, so there is no way to add one of
   * these buttons without explaining it.
   */
  label: string;
}

/**
 * IconButton is a square icon-only button that always carries a tooltip.
 *
 * Icon buttons used to rely on the native `title` attribute, which only appears
 * on mouse hover after a delay and never on keyboard focus.
 *
 * Borderless by default: these live inside cards, fields and table rows that
 * already draw an edge, so a box around the icon would be a box inside a box.
 * Pass `variant` to override — the delete in a header is sometimes a real
 * button rather than a row action.
 *
 * It carries its own tooltip provider so it works wherever it is dropped,
 * including in a test that renders one component on its own. The app also
 * mounts a provider at the root, which is what coordinates the hover delay
 * between neighbours; nesting is supported and the inner one simply takes over
 * when there is no outer one.
 */
export function IconButton({ label, variant = "quiet", children, ...props }: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant={variant} aria-label={label} {...props}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
