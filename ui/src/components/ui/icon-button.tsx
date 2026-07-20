import * as React from "react";
import { Button } from "@/components/ui/button";
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
 * It carries its own provider so it works wherever it is dropped, including in
 * a test that renders one component on its own. The app also mounts a provider
 * at the root, which is what coordinates the hover delay between neighbours;
 * nesting is supported and the inner one simply takes over when there is no
 * outer one.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, children, ...props }, ref) => (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button ref={ref} size="icon" aria-label={label} {...props}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
);
IconButton.displayName = "IconButton";
