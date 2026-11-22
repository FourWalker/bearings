import type { BoardChat, BoardTask } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { MessageSquarePlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";

import type { BoardContinueTarget, BoardIndex } from "./board.logic";
import { ancestorsOf } from "./board.logic";
import { BoardDotMark } from "./BoardNotes";

/**
 * Project Board fork: a task's threads and "Continue in new thread", opened from its note. The
 * board app's task views (tabs for plan, handoff, decisions) replace this in the next phase.
 */
export function BoardTaskSheet(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask | null;
  readonly continueTargets: ReadonlyArray<BoardContinueTarget>;
  readonly onClose: () => void;
  readonly onOpenTask: (task: BoardTask) => void;
  readonly onOpenChat: (chat: BoardChat) => void;
  readonly onContinue: (task: BoardTask, target: BoardContinueTarget) => void;
}) {
  const gt = useGT();
  const { task } = props;
  return (
    <Sheet
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetPopup side="right" className="w-[min(92vw,30rem)]">
        {task !== null ? (
          <div className="grid content-start gap-4 overflow-y-auto p-5">
            <SheetHeader>
              {ancestorsOf(props.index, task).length > 0 ? (
                <div className="flex flex-wrap gap-1 text-muted-foreground text-xs">
                  {ancestorsOf(props.index, task).map((parent, i) => (
                    <span key={parent.id} className="flex gap-1">
                      {i > 0 ? <span>›</span> : null}
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => props.onOpenTask(parent)}
                      >
                        {parent.title}
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <SheetTitle>{task.title}</SheetTitle>
              {task.description ? <SheetDescription>{task.description}</SheetDescription> : null}
            </SheetHeader>
            {task.next !== null ? (
              <p className="text-sm">
                {gt("Next: {id} – {text}", { id: task.next.id, text: task.next.text })}
              </p>
            ) : null}
            {props.index.kidsOf(task.id).length > 0 ? (
              <section className="grid gap-1">
                <h3 className="font-medium text-muted-foreground text-xs uppercase">
                  {task.level === 1 ? <T>Modules</T> : <T>Tasks</T>}
                </h3>
                {props.index.kidsOf(task.id).map((kid) => (
                  <Button
                    key={kid.id}
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => props.onOpenTask(kid)}
                  >
                    <span className="truncate">{kid.title}</span>
                  </Button>
                ))}
              </section>
            ) : null}
            <section className="grid gap-1">
              <h3 className="font-medium text-muted-foreground text-xs uppercase">
                <T>Threads</T>
              </h3>
              {task.chats.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  <T>No threads on this task yet.</T>
                </p>
              ) : (
                task.chats.map((chat) => (
                  <BoardChatRow key={chat.sessionId} chat={chat} onOpenChat={props.onOpenChat} />
                ))
              )}
            </section>
            <BoardContinueButton
              targets={props.continueTargets}
              onContinue={(target) => props.onContinue(task, target)}
            />
          </div>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}

function BoardChatRow(props: {
  readonly chat: BoardChat;
  readonly onOpenChat: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { chat } = props;
  const live =
    chat.live === "working"
      ? gt("Working")
      : chat.live === "idle"
        ? gt("Idle")
        : chat.live === "ended"
          ? gt("Ended")
          : gt("Offline");
  const label = (
    <span className="flex w-full min-w-0 items-center gap-2 text-start">
      <BoardDotMark
        dot={chat.live === "working" ? "working" : chat.live === "idle" ? "idle" : "offline"}
      />
      <span className="text-muted-foreground text-xs">{live}</span>
      <span className="min-w-0 flex-1 truncate">{chat.title || chat.sessionId}</span>
      <span className="text-muted-foreground text-xs">{chat.provider ?? chat.workspaceLabel}</span>
    </span>
  );
  // Claude Code chats and threads of another install can't open here.
  return chat.threadId !== null ? (
    <Button variant="ghost" size="sm" className="w-full" onClick={() => props.onOpenChat(chat)}>
      {label}
    </Button>
  ) : (
    <div className="px-2 text-sm">{label}</div>
  );
}

function BoardContinueButton(props: {
  readonly targets: ReadonlyArray<BoardContinueTarget>;
  readonly onContinue: (target: BoardContinueTarget) => void;
}) {
  const [only, ...rest] = props.targets;
  if (only === undefined) return null;
  const label = (
    <>
      <MessageSquarePlusIcon />
      <T>Continue in new thread</T>
    </>
  );
  if (rest.length === 0)
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => props.onContinue(only)}>
          {label}
        </Button>
      </div>
    );
  return (
    <div>
      <Menu>
        <MenuTrigger render={<Button variant="outline" size="sm" />}>{label}</MenuTrigger>
        <MenuPopup align="start">
          {props.targets.map((target) => (
            <MenuItem key={target.projectId} onClick={() => props.onContinue(target)}>
              {target.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
