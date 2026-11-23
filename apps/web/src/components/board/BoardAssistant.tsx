import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import {
  ArrowUpIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PaletteIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn, newMessageId, newThreadId } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { boardEnvironment } from "~/state/board";
import {
  readProject,
  readThreadShell,
  useThreadProjection,
  useThreadShell,
} from "~/state/entities";
import { formatEnvironmentQueryError } from "~/state/query";
import { environmentServerConfigsAtom } from "~/state/server";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { assistantBubbles, isAssistantBusy, latestExchange } from "./board.logic";
import { TackAvatar, useTackLook } from "./TackAvatar";
import { tackMood, tackNoteCount, type TackMotion, type TackSkin } from "./tackAvatar.logic";

/** How long after the last keystroke Tack still counts as being typed to. */
const TYPING_LINGER_MS = 800;

const AssistantState = Schema.Struct({
  threadId: Schema.NullOr(Schema.String),
  view: Schema.Literals(["closed", "open", "expanded"]),
});
const CLOSED: typeof AssistantState.Type = { threadId: null, view: "closed" };

/**
 * Project Board fork: Tack, the board's Assistant, as a chat that floats over the board. It is a
 * real thread marked as the Assistant, so its history is kept and it can open as a full thread;
 * the board stays in view while the person talks to it.
 */
export function BoardAssistant(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly boardName: string;
  /** A T3 project in one of the board's workspaces: where the Assistant's thread lives. */
  readonly projectId: ProjectId;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId, boardId, projectId } = props;
  const [state, setState] = useLocalStorage(
    `t3.board.assistant:${environmentId}:${boardId}`,
    CLOSED,
    AssistantState,
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [failed, setFailed] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [look, setLook] = useTackLook();
  const canAsk = useAtomValue(boardEnvironment.linkThread.permissionAtom(environmentId));
  const linkThread = useAtomCommand(boardEnvironment.linkThread, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const threadRef =
    state.threadId === null ? null : scopeThreadRef(environmentId, ThreadId.make(state.threadId));
  const shell = useThreadShell(threadRef);
  // The thread's messages are followed only while the chat is open.
  const thread = useThreadProjection(state.view === "closed" ? null : threadRef);
  const bubbles = assistantBubbles(thread?.projection.messages ?? []);
  const busy = sending || isAssistantBusy(shell?.runtime?.status);
  const waiting = shell?.hasPendingApprovals === true || shell?.hasPendingUserInput === true;
  if (!canAsk) return null;
  const avatar = {
    skin: look.skin,
    motion: look.motion,
    mood: tackMood({ open: state.view !== "closed", busy, waiting, typing, failed }),
    notes: tackNoteCount(thread?.projection.turnItems ?? []),
  };

  const fail = (description: string) => {
    setFailed(true);
    toastManager.add({
      type: "error",
      title: gt("Could not start the Board Assistant"),
      description,
    });
  };
  const noteTyping = () => {
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), TYPING_LINGER_MS);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setFailed(false);
    setTyping(false);
    setDraft("");
    try {
      const createdAt = new Date().toISOString();
      const turn = {
        messageId: newMessageId(),
        role: "user" as const,
        text: message,
        attachments: [],
      };
      const existing = threadRef === null ? null : readThreadShell(threadRef);
      if (threadRef !== null && existing !== null) {
        const result = await startTurn({
          environmentId,
          input: {
            threadId: threadRef.threadId,
            message: turn,
            runtimeMode: existing.runtimeMode,
            interactionMode: existing.interactionMode,
            createdAt,
          },
        });
        if (result._tag === "Failure") fail(gt("The message could not be sent."));
        return;
      }
      const configs = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
      const settings = configs?.settings ?? DEFAULT_SERVER_SETTINGS;
      const providers = configs?.providers ?? [];
      const modelSelection = resolveNewThreadModelSelection({
        defaultSelection:
          resolveProjectSettings(
            settings,
            projectId,
            readProject(scopeProjectRef(environmentId, projectId)),
          ).settings.defaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(providers, settings, projectId),
        fallbackSelection: settings.fallbackModelSelection ?? null,
        providers,
        settings,
        projectId,
        now: Date.now(),
      }).selection;
      if (modelSelection === null) {
        fail(gt("No model is set up for this project."));
        return;
      }
      const threadId = newThreadId();
      // Marked as the Assistant before its first turn, so that turn already gets its rules.
      const linked = await linkThread({
        environmentId,
        input: { boardId, taskId: null, threadId, projectId },
      });
      if (linked._tag === "Failure") {
        fail(formatEnvironmentQueryError(linked.cause));
        return;
      }
      // Supervised: the Assistant answers and shows; it is not there to change code.
      const modes = { runtimeMode: "approval-required", interactionMode: "default" } as const;
      const title = gt("Tack · {board}", { board: props.boardName });
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: turn,
          modelSelection,
          ...modes,
          bootstrap: {
            createThread: {
              projectId,
              title,
              modelSelection,
              ...modes,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        fail(gt("The message could not be sent."));
        return;
      }
      setState((previous) => ({ ...previous, threadId }));
    } finally {
      setSending(false);
    }
  };

  if (state.view === "closed")
    return (
      <div className="pointer-events-none fixed end-4 bottom-4 z-[70]">
        <button
          type="button"
          data-board-assistant="closed"
          aria-label={gt("Ask the board")}
          className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-2 ps-3 pe-4 text-sm shadow-lg hover:bg-accent"
          onClick={() => setState((previous) => ({ ...previous, view: "open" }))}
        >
          {/* The sprite's cell has empty rows around the body; the margins trim them in the pill. */}
          <TackAvatar {...avatar} scale={2} className="-my-3 -ms-3 -me-2" />
          <span className="font-medium">{gt("Ask Tack")}</span>
          {busy || waiting ? (
            <span
              aria-hidden
              className={cn("size-2 rounded-full", waiting ? "bg-warning" : "bg-success")}
            />
          ) : null}
        </button>
      </div>
    );

  const expanded = state.view === "expanded";
  const shown = expanded ? bubbles : latestExchange(bubbles);
  return (
    <div className="pointer-events-none fixed end-4 bottom-4 z-[70]">
      {look.skin === "emoji" ? null : (
        // Perched on the chat's top edge: the cell's two empty bottom rows sit below the feet.
        <div className="pointer-events-auto absolute end-5 bottom-full -mb-[7px] cursor-pointer">
          <TackAvatar {...avatar} from="rest" scale={3} pokeable />
        </div>
      )}
      <section
        data-board-assistant={state.view}
        aria-label={gt("Board Assistant")}
        className={cn(
          "pointer-events-auto flex flex-col overflow-hidden rounded-xl border bg-popover shadow-xl",
          expanded
            ? "h-[min(44rem,80vh)] w-[min(34rem,90vw)]"
            : "max-h-[30rem] w-[min(23rem,90vw)]",
        )}
      >
        <header className="flex items-center gap-1 border-b px-3 py-2">
          {look.skin === "emoji" ? <TackAvatar {...avatar} scale={1} /> : null}
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-sm">{gt("Tack")}</span>
            <span className="ms-2 text-muted-foreground text-xs">{props.boardName}</span>
          </span>
          <TackLookMenu
            skin={look.skin}
            motion={look.motion}
            onSkin={(skin) => setLook((previous) => ({ ...previous, skin }))}
            onMotion={(motion) => setLook((previous) => ({ ...previous, motion }))}
          />
          <HeaderButton
            label={expanded ? gt("Hide history") : gt("Show history")}
            onClick={() =>
              setState((previous) => ({ ...previous, view: expanded ? "open" : "expanded" }))
            }
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </HeaderButton>
          {threadRef !== null ? (
            <>
              <HeaderButton
                label={gt("Open as a thread")}
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(threadRef),
                  })
                }
              >
                <ExternalLinkIcon />
              </HeaderButton>
              <HeaderButton
                label={gt("New conversation")}
                onClick={() => setState((previous) => ({ ...previous, threadId: null }))}
              >
                <RotateCcwIcon />
              </HeaderButton>
            </>
          ) : null}
          <HeaderButton
            label={gt("Minimize")}
            onClick={() => setState((previous) => ({ ...previous, view: "closed" }))}
          >
            <MinusIcon />
          </HeaderButton>
        </header>
        {/* Reversed, so the newest message stays in view as replies grow, with no scroll effect. */}
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-2">
          <div className="grid gap-2">
            {shown.length === 0 ? (
              <AssistantWelcome onAsk={(question) => void send(question)} />
            ) : (
              shown.map((bubble) => (
                <div
                  key={bubble.id}
                  data-board-assistant-bubble={bubble.role}
                  className={cn(
                    "max-w-[90%] rounded-lg px-3 py-1.5 text-sm",
                    bubble.role === "user" ? "justify-self-end bg-primary/15" : "bg-muted",
                  )}
                >
                  {bubble.role === "user" ? (
                    <span className="whitespace-pre-wrap">{bubble.text}</span>
                  ) : (
                    <ChatMarkdown
                      text={bubble.text}
                      cwd={undefined}
                      environmentId={environmentId}
                      isStreaming={bubble.streaming}
                      headingLevelOffset={3}
                    />
                  )}
                </div>
              ))
            )}
            {threadRef !== null && waiting ? (
              <AssistantApprovals environmentId={environmentId} threadRef={threadRef} />
            ) : busy ? (
              <p className="text-muted-foreground text-xs">
                <T>Tack is checking the board…</T>
              </p>
            ) : null}
          </div>
        </div>
        <form
          className="flex items-end gap-2 border-t p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <div className="min-w-0 flex-1">
            <Textarea
              size="sm"
              rows={1}
              value={draft}
              aria-label={gt("Message to the Board Assistant")}
              placeholder={gt("Ask Tack about this board…")}
              onChange={(event) => {
                setDraft(event.target.value);
                noteTyping();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                void send(draft);
              }}
            />
          </div>
          <Button
            type="submit"
            size="icon-sm"
            aria-label={gt("Send")}
            disabled={sending || draft.trim().length === 0}
          >
            <ArrowUpIcon />
          </Button>
        </form>
      </section>
    </div>
  );
}

function HeaderButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Picks Tack's avatar and how much it moves; kept on this device. */
function TackLookMenu(props: {
  readonly skin: TackSkin;
  readonly motion: TackMotion;
  readonly onSkin: (skin: TackSkin) => void;
  readonly onMotion: (motion: TackMotion) => void;
}) {
  const gt = useGT();
  const skins: ReadonlyArray<readonly [TackSkin, string]> = [
    ["claude", gt("Claude")],
    ["ivory", gt("Claude Ivory")],
    ["mint", gt("Claude Mint")],
    ["night", gt("Claude Night")],
    ["pin", gt("Pushpin")],
    ["emoji", gt("Emoji, no animation")],
  ];
  const motions: ReadonlyArray<readonly [TackMotion, string]> = [
    ["full", gt("Full animation")],
    ["calm", gt("Calm: reactions only")],
    ["still", gt("Still")],
  ];
  return (
    <Menu>
      <MenuTrigger
        aria-label={gt("Tack's look")}
        render={<Button size="icon-xs" variant="ghost-muted" />}
      >
        <PaletteIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>{gt("Avatar")}</MenuGroupLabel>
          <MenuRadioGroup
            value={props.skin}
            onValueChange={(next) => props.onSkin(next as TackSkin)}
          >
            {skins.map(([skin, label]) => (
              <MenuRadioItem key={skin} value={skin}>
                <span className="flex items-center gap-2">
                  <TackAvatar skin={skin} motion="still" mood="idle" scale={1} />
                  {label}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>{gt("Animation")}</MenuGroupLabel>
          <MenuRadioGroup
            value={props.motion}
            onValueChange={(next) => props.onMotion(next as TackMotion)}
          >
            {motions.map(([motion, label]) => (
              <MenuRadioItem key={motion} value={motion}>
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** What Tack says before the first question, with a few to start from. */
function AssistantWelcome(props: { readonly onAsk: (question: string) => void }) {
  const gt = useGT();
  const starters = [
    gt("What is in progress?"),
    gt("What is blocked?"),
    gt("What should I pick up next?"),
  ];
  return (
    <div className="grid gap-2 py-1">
      <p className="text-sm">
        <T>
          I'm Tack. I keep this board pinned together. Ask me what's on it, or tell me what to find
          and I'll put it on your screen.
        </T>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
            onClick={() => props.onAsk(starter)}
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A tool call waiting for the person: answered here, without leaving the board. */
function AssistantApprovals(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const pending = useAtomValue(environmentThreadDetails.pendingRequestsAtom(props.threadRef));
  const respond = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const approval = pending?.approvals[0];
  if (approval === undefined)
    return (
      <p className="text-muted-foreground text-xs">
        <T>Tack is waiting for an answer in its thread.</T>
      </p>
    );
  const answer = (decision: "accept" | "decline") =>
    void respond({
      environmentId: props.environmentId,
      input: { threadId: props.threadRef.threadId, requestId: approval.requestId, decision },
    });
  return (
    <div data-board-assistant-approval className="grid gap-1.5 rounded-lg border px-3 py-2 text-sm">
      <span>{approval.detail ?? gt("Tack wants to make a change.")}</span>
      {approval.responseCapability === "live" ? (
        <span className="flex gap-2">
          <Button size="compact" onClick={() => answer("accept")}>
            <T>Approve</T>
          </Button>
          <Button size="compact" variant="ghost" onClick={() => answer("decline")}>
            <T>Decline</T>
          </Button>
        </span>
      ) : null}
    </div>
  );
}
