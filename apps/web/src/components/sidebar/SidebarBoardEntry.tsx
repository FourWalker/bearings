import { useLocation, useNavigate } from "@tanstack/react-router";
import { T } from "gt-react";
import { SquareKanbanIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useProjectBoardSupported } from "../../state/environments";
import { useSidebar } from "../ui/sidebar";

/** Project Board fork: the board's own row under the thread search, where it's easy to find. */
export function SidebarBoardEntry() {
  const supported = useProjectBoardSupported();
  const navigate = useNavigate();
  const onBoard = useLocation({ select: (location) => location.pathname === "/board" });
  const { isMobile, setOpenMobile } = useSidebar();
  if (!supported) return null;
  return (
    <button
      type="button"
      aria-current={onBoard ? "page" : undefined}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        void navigate({ to: "/board" });
      }}
      className={cn(
        "mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 font-medium text-sidebar-muted-foreground text-sm hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        onBoard && "bg-sidebar-row-hover text-sidebar-foreground",
      )}
    >
      <SquareKanbanIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
      <T context="sidebar link to the Project Board">Board</T>
    </button>
  );
}
