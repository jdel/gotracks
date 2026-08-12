import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        // A bare <button> inside a <form> submits it. That default has caught
        // this app out — the clear-date button in the action editor was
        // submitting the form, which saves and closes the sheet, so tapping it
        // looked like the drawer dismissing itself. Every button that really
        // does submit says so explicitly; the rest do not want it.
        // asChild renders someone else's element, which may not be a button.
        {...(asChild ? {} : { type: type ?? "button" })}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
