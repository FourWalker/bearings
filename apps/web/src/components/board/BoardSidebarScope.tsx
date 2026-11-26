import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ListFilterIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { useUiStateStore } from "~/uiStateStore";

import { boardSidebarScope } from "./boardSidebar.logic";

const Boards = Schema.Array(Schema.String);
const NONE: typeof Boards.Type = [];

/**
 * Project Board fork: with a board open, the sidebar lists that board's threads. It drives the
 * sidebar's own project scope, so the sidebar's scope menu shows it and can change it; the
 * button keeps, per board on this device, whether the sidebar lists every thread instead.
 */
export function BoardSidebarScope(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly roots: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const groups = useSidebarProjectGroups();
  const setScope = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
  const [wide, setWide] = useLocalStorage("t3.board.sidebar.all", NONE, Boards);
  const all = wide.includes(props.boardId);
  const scope = boardSidebarScope(groups, props.environmentId, props.roots).join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a board is opened by links, the picker and the palette alike, and only here are its projects known: writes them to the sidebar's scope store
  useEffect(() => {
    if (scope !== "") setScope(all ? [] : scope.split("\n"));
  }, [all, scope, setScope]);
  if (scope === "") return null;
  const label = all
    ? gt("The sidebar lists every thread")
    : gt("The sidebar lists this board's threads");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-pressed={!all}
            aria-label={label}
            onClick={() => {
              if (all) return setWide(wide.filter((id) => id !== props.boardId));
              setWide([...wide, props.boardId]);
            }}
          />
        }
      >
        <ListFilterIcon />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
