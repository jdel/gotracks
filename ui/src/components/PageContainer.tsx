import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const sizes = {
  standard: "max-w-4xl",
  wide: "max-w-6xl",
};

export function PageContainer({
  children,
  size = "standard",
  className,
}: {
  children: ReactNode;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full space-y-6", sizes[size], className)}>
      {children}
    </div>
  );
}
