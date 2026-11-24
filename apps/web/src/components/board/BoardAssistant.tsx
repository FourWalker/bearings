import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
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

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { type BoardAssistantBubble, latestExchange } from "./board.logic";
import { TackAvatar, useTackLook, useTackPen } from "./TackAvatar";
import type { TackMotion, TackSkin } from "./tackAvatar.logic";
import type { PlotterInk, PlotterSpeed } from "./tackPlotter.logic";
import type { TackShowMode } from "./BoardTack";
import type { TackPlace } from "./tackPlace.logic";
import { type TackChat, type TackChatProps, useTackChat } from "./useTackChat";

/**
 * Project Board fork: Tack as a chat that floats over the board, the original way Tack sits on
 * the board and the one used on a task page.
 */
export function BoardAssistant(
  props: TackChatProps & {
    readonly place?: TackPlace;
    readonly onPlace?: (place: TackPlace) => void;
  },
) {
  const gt = useGT();
  const chat = useTackChat(props, { follow: false });
  const [look, setLook] = useTackLook();
  if (!chat.canAsk) return null;
  const avatar = { skin: look.skin, motion: look.motion, mood: chat.mood, notes: chat.notes };

  if (chat.view === "closed")
    return (
      <div className="pointer-events-none fixed end-4 bottom-4 z-[70]">
        <button
          type="button"
          data-board-assistant="closed"
          aria-label={gt("Ask the board")}
          className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-2 ps-3 pe-4 text-sm shadow-lg hover:bg-accent"
          onClick={() => chat.setView("open")}
        >
          {/* The sprite's cell has empty rows around the body; the margins trim them in the pill. */}
          <TackAvatar {...avatar} scale={2} className="-my-3 -ms-3 -me-2" />
          <span className="font-medium">{gt("Ask Tack")}</span>
          {chat.busy || chat.waiting ? (
            <span
              aria-hidden
              className={cn("size-2 rounded-full", chat.waiting ? "bg-warning" : "bg-success")}
            />
          ) : null}
        </button>
      </div>
    );

  const expanded = chat.view === "expanded";
  return (
    <div className="pointer-events-none fixed end-4 bottom-4 z-[70]">
      {look.skin === "emoji" ? null : (
        // Perched on the chat's top edge: the cell's two empty bottom rows sit below the feet.
        <div className="pointer-events-auto absolute end-5 bottom-full -mb-[7px] cursor-pointer">
          <TackAvatar {...avatar} from="rest" scale={3} pokeable />
        </div>
      )}
      <section
        data-board-assistant={chat.view}
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
            {...(props.place !== undefined && props.onPlace !== undefined
              ? { place: props.place, onPlace: props.onPlace }
              : {})}
          />
          <HeaderButton
            label={expanded ? gt("Hide history") : gt("Show history")}
            onClick={() => chat.setView(expanded ? "open" : "expanded")}
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </HeaderButton>
          <TackThreadButtons chat={chat} />
          <HeaderButton label={gt("Minimize")} onClick={() => chat.setView("closed")}>
            <MinusIcon />
          </HeaderButton>
        </header>
        <TackMessages
          chat={chat}
          environmentId={props.environmentId}
          bubbles={expanded ? chat.bubbles : latestExchange(chat.bubbles)}
        />
        <TackComposer chat={chat} className="border-t p-2" />
      </section>
    </div>
  );
}

/** Opens Tack's thread in full, or starts a new conversation. */
export function TackThreadButtons(props: { readonly chat: TackChat }) {
  const gt = useGT();
  const navigate = useNavigate();
  const { threadRef } = props.chat;
  if (threadRef === null) return null;
  return (
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
      <HeaderButton label={gt("New conversation")} onClick={props.chat.reset}>
        <RotateCcwIcon />
      </HeaderButton>
    </>
  );
}

/** Tack's messages, newest at the bottom, with its welcome before the first question. */
export function TackMessages(props: {
  readonly chat: TackChat;
  readonly environmentId: EnvironmentId;
  readonly bubbles: ReadonlyArray<BoardAssistantBubble>;
  readonly className?: string;
}) {
  const { chat } = props;
  return (
    // Reversed, so the newest message stays in view as replies grow, with no scroll effect.
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-2",
        props.className,
      )}
    >
      <div className="grid gap-2">
        {props.bubbles.length === 0 ? (
          <AssistantWelcome onAsk={(question) => void chat.send(question)} />
        ) : (
          props.bubbles.map((bubble) => (
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
                  environmentId={props.environmentId}
                  isStreaming={bubble.streaming}
                  headingLevelOffset={3}
                />
              )}
            </div>
          ))
        )}
        {chat.threadRef !== null && chat.waiting ? (
          <AssistantApprovals environmentId={props.environmentId} threadRef={chat.threadRef} />
        ) : chat.busy ? (
          <p className="text-muted-foreground text-xs">
            <T>Tack is checking the board…</T>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The box a person types to Tack in. */
export function TackComposer(props: {
  readonly chat: TackChat;
  readonly className?: string;
  readonly autoFocus?: boolean;
}) {
  const gt = useGT();
  const { chat } = props;
  return (
    <form
      className={cn("flex items-end gap-2", props.className)}
      onSubmit={(event) => {
        event.preventDefault();
        void chat.send(chat.draft);
      }}
    >
      <div className="min-w-0 flex-1">
        <Textarea
          size="sm"
          rows={1}
          value={chat.draft}
          autoFocus={props.autoFocus}
          aria-label={gt("Message to the Board Assistant")}
          placeholder={gt("Ask Tack about this board…")}
          onChange={(event) => chat.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void chat.send(chat.draft);
          }}
        />
      </div>
      <Button
        type="submit"
        size="icon-sm"
        aria-label={gt("Send")}
        disabled={chat.sending || chat.draft.trim().length === 0}
      >
        <ArrowUpIcon />
      </Button>
    </form>
  );
}

export function HeaderButton(props: {
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
export function TackLookMenu(props: {
  readonly skin: TackSkin;
  readonly motion: TackMotion;
  readonly onSkin: (skin: TackSkin) => void;
  readonly onMotion: (motion: TackMotion) => void;
  readonly place?: TackPlace;
  readonly onPlace?: (place: TackPlace) => void;
  readonly show?: TackShowMode;
  readonly onShow?: (show: TackShowMode) => void;
}) {
  const gt = useGT();
  const shows: ReadonlyArray<readonly [TackShowMode, string]> = [
    ["walk", gt("Walk to the note, keep the board in view")],
    ["open", gt("Open the task right away")],
  ];
  const places: ReadonlyArray<readonly [TackPlace, string]> = [
    ["roam", gt("Roamer: sleeps in its corner, walks to notes")],
    ["host", gt("Panel host: says where things stand")],
    ["float", gt("Floating chat")],
  ];
  const skins: ReadonlyArray<readonly [TackSkin, string]> = [
    ["claude", gt("Claude")],
    ["ivory", gt("Claude Ivory")],
    ["mint", gt("Claude Mint")],
    ["night", gt("Claude Night")],
    ["pin", gt("Pushpin")],
    ["plotter", gt("Plotter: a pen draws Tack")],
    ["emoji", gt("Emoji, no animation")],
  ];
  const [pen, setPen] = useTackPen();
  const speeds: ReadonlyArray<readonly [PlotterSpeed, string]> = [
    ["slow", gt("Slow, to watch it draw")],
    ["app", gt("Quick: draws in under a second")],
    ["fast", gt("Fast")],
  ];
  const inks: ReadonlyArray<readonly [PlotterInk, string]> = [
    ["chase", gt("Old ink: its tail chases it off")],
    ["retrace", gt("Old ink: the pen eats it back")],
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
        {props.place !== undefined && props.onPlace !== undefined ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>{gt("Where Tack lives")}</MenuGroupLabel>
              <MenuRadioGroup
                value={props.place}
                onValueChange={(next) => props.onPlace?.(next as TackPlace)}
              >
                {places.map(([place, label]) => (
                  <MenuRadioItem key={place} value={place}>
                    {label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        {props.show !== undefined && props.onShow !== undefined ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>{gt("When Tack points at a task")}</MenuGroupLabel>
              <MenuRadioGroup
                value={props.show}
                onValueChange={(next) => props.onShow?.(next as TackShowMode)}
              >
                {shows.map(([show, label]) => (
                  <MenuRadioItem key={show} value={show}>
                    {label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
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
        {props.skin === "plotter" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>{gt("Pen")}</MenuGroupLabel>
              <MenuRadioGroup
                value={pen.speed}
                onValueChange={(next) =>
                  setPen((previous) => ({ ...previous, speed: next as PlotterSpeed }))
                }
              >
                {speeds.map(([speed, label]) => (
                  <MenuRadioItem key={speed} value={speed}>
                    {label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuRadioGroup
                value={pen.ink}
                onValueChange={(next) =>
                  setPen((previous) => ({ ...previous, ink: next as PlotterInk }))
                }
              >
                {inks.map(([ink, label]) => (
                  <MenuRadioItem key={ink} value={ink}>
                    {label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuCheckboxItem
                checked={pen.hops}
                onCheckedChange={(hops) => setPen((previous) => ({ ...previous, hops }))}
              >
                {gt("Show the pen moving between strokes")}
              </MenuCheckboxItem>
              <MenuCheckboxItem
                checked={pen.wobble}
                onCheckedChange={(wobble) => setPen((previous) => ({ ...previous, wobble }))}
              >
                {gt("Hand-inked wobble")}
              </MenuCheckboxItem>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** What Tack says before the first question, with a few to start from. */
export function AssistantWelcome(props: { readonly onAsk: (question: string) => void }) {
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
export function AssistantApprovals(props: {
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
