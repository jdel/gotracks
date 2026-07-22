import * as React from "react";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";

export interface OverflowAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * OverflowMenu collapses secondary row actions behind a single "⋯" button, so a
 * card row shows at most a few icons instead of a wide cluster. Pass the actions
 * that should live in the menu; the caller keeps the one or two primary actions
 * inline next to it.
 */
export function OverflowMenu({ label, actions }: { label: string; actions: OverflowAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" className="size-7" label={label}>
          <MoreVertical className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.label}
            destructive={a.destructive}
            disabled={a.disabled}
            onSelect={a.onSelect}
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
