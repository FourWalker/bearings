import { useGT } from "gt-react";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useLayoutEffect } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarThreadRow";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  revealOverflow?: boolean;
  "data-testid"?: string;
}) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the projected drop box inside the scroll viewport as drag transforms move it
  useLayoutEffect(() => {
    if (props.revealOverflow && transform?.y !== undefined) {
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [node, props.revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
      // Revealing on every drag scrolls the list out from under the pointer.
      revealOverflow={
        props.marker === "settled-placeholder" && props.showHint && props.isDropTarget
      }
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  /** Project Board fork: compact rows keep the Pinned header and its divider in view. */
  persistent?: boolean;
  isDropTarget: boolean;
}) {
  const header = props.marker === "pinned-header";
  if (props.persistent) {
    return (
      <SortableSidebarMarker
        marker={props.marker}
        data-testid={`sidebar-${props.marker}`}
        className={cn("pointer-events-none relative mx-0.5", header ? "h-7" : "h-3")}
      >
        <div
          data-sidebar-pinned-rule={header ? "header" : "divider"}
          className="absolute inset-x-2 top-1/2 flex h-4 -translate-y-1/2 items-center gap-2"
        >
          {header || props.visible ? (
            <span
              className={cn(
                "shrink-0 text-xs font-medium",
                props.isDropTarget ? "text-primary" : "text-sidebar-muted-foreground",
              )}
            >
              {props.label}
            </span>
          ) : null}
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-border/70",
            )}
          />
        </div>
      </SortableSidebarMarker>
    );
  }
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  label: string;
  /** A muted trailing count. */
  count: number;
  className?: string;
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
  /** Beside the header button, not inside it: a control of its own. */
  trailing?: ReactNode;
}) {
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("relative mx-0.5 flex h-8 items-center gap-1", props.className)}
    >
      <CollapsibleSectionHeader
        data-sidebar-row={`shelf:${shelf}`}
        onClick={props.toggle.onToggle}
        expanded={props.toggle.expanded}
        tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
        accessory={
          // Keyed so a new count can play its arrival (Project Board fork).
          <span key={props.count} data-shelf-count className="font-normal tabular-nums">
            {props.count}
          </span>
        }
      >
        {props.label}
        {shelf === "working" ? (
          <svg data-shelf-mark viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden>
            <path d="M0 3C8 0 12 6 20 3S32 0 40 3S52 6 60 3S72 0 80 3S92 6 100 3" pathLength={1} />
          </svg>
        ) : null}
      </CollapsibleSectionHeader>
      {props.trailing}
    </SortableSidebarMarker>
  );
}

/** Project Board fork: the Working shelf lists chats at work on every board, or only in scope. */
export function SidebarWorkingScopeSwitch(props: {
  everywhere: boolean;
  /** Chats at work outside the sidebar's scope. */
  elsewhere: number;
  onToggle: () => void;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <label
            data-sidebar-working-scope
            className="flex shrink-0 cursor-pointer items-center gap-1.5 pe-1.5 text-2xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
          />
        }
      >
        {!props.everywhere && props.elsewhere > 0 ? (
          <span className="tabular-nums">
            {gt("+{count} elsewhere", { count: props.elsewhere })}
          </span>
        ) : (
          <span>{gt("All boards")}</span>
        )}
        <Switch
          size="sm"
          checked={props.everywhere}
          onCheckedChange={props.onToggle}
          aria-label={gt("All boards")}
        />
      </TooltipTrigger>
      <TooltipPopup>
        {gt("Show chats at work on every board, not only the projects this list is filtered to")}
      </TooltipPopup>
    </Tooltip>
  );
}
