import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { TACK_SKINS, type TackMotion, type TackSkin } from "~/components/board/tackAvatar.logic";
import { TackAvatar, useTackLook, useTackPen } from "~/components/board/TackAvatar";
import { usePinCatch } from "~/components/board/BoardPinBar";
import { useStarReviewOff } from "~/components/board/BoardTree";
import { useTackPlace, useTackShowMode } from "~/components/board/BoardTack";
import {
  type TackAccess,
  type TackModelRole,
  useBoardPanelOpen,
  useTackAccess,
  useTackHome,
  useTackModels,
} from "~/components/board/tackSettings";
import { useTaskTackSize } from "~/components/board/useTaskChat";
import { useEnvironmentProviders, useEnvironments } from "~/state/environments";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SEPARATOR = "\u0001";
const DEFAULT_MODEL = "default";

function Choice<Value extends string>(props: {
  readonly label: string;
  readonly value: Value;
  readonly options: ReadonlyArray<readonly [Value, string]>;
  readonly onChange: (value: Value) => void;
  readonly wide?: boolean;
}) {
  const current = props.options.find(([value]) => value === props.value)?.[1] ?? props.value;
  return (
    <div className={props.wide === true ? "w-full sm:w-72" : "w-full sm:w-56"}>
      <Select
        value={props.value}
        onValueChange={(next) => {
          const hit = props.options.find(([value]) => value === next);
          if (hit !== undefined) props.onChange(hit[0]);
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0" aria-label={props.label}>
          <SelectValue>{current}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {props.options.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

/**
 * Project Board fork: everything about Tack in one place. All of it is kept on this device; the
 * board's own menus change the same values.
 */
export function TackSettingsPanel() {
  const gt = useGT();
  const [look, setLook] = useTackLook();
  const [pen, setPen] = useTackPen();
  const [place, setPlace] = useTackPlace();
  const [home, setHome] = useTackHome();
  const [show, setShow] = useTackShowMode();
  const [panelOpen, setPanelOpen] = useBoardPanelOpen();
  const [catching, setCatching] = usePinCatch();
  const [reviewOff, setReviewOff] = useStarReviewOff();
  const [taskSize, setTaskSize] = useTaskTackSize();
  const [models, setModels] = useTackModels();
  const [access, setAccess] = useTackAccess();
  const accesses: ReadonlyArray<readonly [TackAccess, string]> = [
    ["ask", gt("Asks before each step")],
    ["full", gt("Full access")],
  ];
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const boards = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.projectBoard === true,
  );

  const skins: Record<TackSkin, string> = {
    claude: gt("Claude"),
    ivory: gt("Claude Ivory"),
    mint: gt("Claude Mint"),
    night: gt("Claude Night"),
    pin: gt("Pushpin"),
    plotter: gt("Plotter: a pen draws Tack"),
    emoji: gt("Emoji, no animation"),
  };
  const motions: ReadonlyArray<readonly [TackMotion, string]> = [
    ["full", gt("Full animation")],
    ["calm", gt("Calm: reactions only")],
    ["still", gt("Still")],
  ];
  const row = (title: string, description: string, control: ReactNode) => (
    <SettingsRow title={title} description={description} devicePreference control={control} />
  );
  const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void) => (
    <Switch
      checked={checked}
      onCheckedChange={(next) => onChange(Boolean(next))}
      aria-label={label}
    />
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="tack-place" title={gt("Where Tack lives")}>
        {row(
          gt("On the board"),
          gt("How Tack sits on a board: asleep in a corner, hosting the side panel, or a chat."),
          <Choice
            wide
            label={gt("On the board")}
            value={place}
            onChange={setPlace}
            options={[
              ["roam", gt("Roamer: sleeps in its corner, walks to notes")],
              ["host", gt("Panel host: says where things stand")],
              ["float", gt("Floating chat")],
            ]}
          />,
        )}
        {row(
          gt("The Roamer's corner"),
          gt("Where the Roamer sleeps. With the side panel hidden it is always on the board."),
          <Choice
            wide
            label={gt("The Roamer's corner")}
            value={home}
            onChange={setHome}
            options={[
              ["board", gt("Bottom right of the board")],
              ["panel", gt("Foot of the side panel")],
            ]}
          />,
        )}
        {row(
          gt("Show the board's side panel"),
          gt(
            "The panel that says where things stand. A button in the board's header does the same.",
          ),
          toggle(gt("Show the board's side panel"), panelOpen, setPanelOpen),
        )}
        {row(
          gt("When Tack points at a task"),
          gt("What happens when an agent shows you a task."),
          <Choice
            wide
            label={gt("When Tack points at a task")}
            value={show}
            onChange={setShow}
            options={[
              ["walk", gt("Walk to the note, keep the board in view")],
              ["open", gt("Open the task right away")],
            ]}
          />,
        )}
        {row(
          gt("In an open task"),
          gt("How much room Tack takes inside a task or module."),
          <Choice
            label={gt("In an open task")}
            value={taskSize}
            onChange={setTaskSize}
            options={[
              ["line", gt("A row at the foot")],
              ["panel", gt("A column beside it")],
            ]}
          />,
        )}
      </SettingsSection>

      <SettingsSection id="tack-access" title={gt("What Tack may do")}>
        {row(
          gt("Board Tack access"),
          gt(
            "Tack on a board answers and shows tasks. Creating a task always needs your yes, whatever is set here.",
          ),
          <Choice
            label={gt("Board Tack access")}
            value={access.board}
            onChange={(board) => setAccess({ ...access, board })}
            options={accesses}
          />,
        )}
        {row(
          gt("Task Tack access"),
          gt(
            "Tack in an open task works on it when the mode is Run. Ask mode always asks before each step.",
          ),
          <Choice
            label={gt("Task Tack access")}
            value={access.task}
            onChange={(task) => setAccess({ ...access, task })}
            options={accesses}
          />,
        )}
      </SettingsSection>

      <SettingsSection id="tack-look" title={gt("Look")}>
        <SettingsRow
          title={gt("Avatar")}
          description={gt("Tack's skin. Sub Tacks and its notices follow it.")}
          devicePreference
          control={
            <div className="flex items-center gap-3">
              <TackAvatar skin={look.skin} motion="still" mood="idle" scale={2} />
              <Choice
                label={gt("Avatar")}
                value={look.skin}
                onChange={(skin) => setLook((previous) => ({ ...previous, skin }))}
                options={TACK_SKINS.map((skin) => [skin, skins[skin]] as const)}
              />
            </div>
          }
        />
        {row(
          gt("Animation"),
          gt("How much Tack moves. Still also stops the Pin bar's movement."),
          <Choice
            label={gt("Animation")}
            value={look.motion}
            onChange={(motion) => setLook((previous) => ({ ...previous, motion }))}
            options={motions}
          />,
        )}
        {look.skin === "plotter" ? (
          <>
            {row(
              gt("Pen speed"),
              gt("How fast the Plotter draws a new figure."),
              <Choice
                wide
                label={gt("Pen speed")}
                value={pen.speed}
                onChange={(speed) => setPen((previous) => ({ ...previous, speed }))}
                options={[
                  ["slow", gt("Slow, to watch it draw")],
                  ["app", gt("Quick: draws in under a second")],
                  ["fast", gt("Fast")],
                ]}
              />,
            )}
            {row(
              gt("Old ink"),
              gt("How the drawing before leaves the paper."),
              <Choice
                wide
                label={gt("Old ink")}
                value={pen.ink}
                onChange={(ink) => setPen((previous) => ({ ...previous, ink }))}
                options={[
                  ["chase", gt("Old ink: its tail chases it off")],
                  ["retrace", gt("Old ink: the pen eats it back")],
                ]}
              />,
            )}
            {row(
              gt("Show the pen moving between strokes"),
              gt("The pen's travel between strokes, as a real plotter's."),
              toggle(gt("Show the pen moving between strokes"), pen.hops, (hops) =>
                setPen((previous) => ({ ...previous, hops })),
              ),
            )}
            {row(
              gt("Hand-inked wobble"),
              gt("A slight unevenness in every line."),
              toggle(gt("Hand-inked wobble"), pen.wobble, (wobble) =>
                setPen((previous) => ({ ...previous, wobble })),
              ),
            )}
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection id="tack-pin" title={gt("Pinned task or module")}>
        {row(
          gt("Catch my eye when it needs me"),
          gt("What the Pin bar does when the pinned item is blocked or waits for you."),
          <Choice
            wide
            label={gt("Catch my eye when it needs me")}
            value={catching}
            onChange={setCatching}
            options={[
              ["off", gt("Off: colour only")],
              ["theme", gt("By theme: the bar itself moves")],
              ["tack", gt("By Tack: a Sub Tack goes to the bar")],
            ]}
          />,
        )}
      </SettingsSection>

      <SettingsSection id="board-stars" title={gt("Starred items")}>
        {row(
          gt("Daily star review"),
          gt(
            "The first time a board opens each day, list its starred items so you can unstar some.",
          ),
          toggle(gt("Daily star review"), !reviewOff, (on) => setReviewOff(!on)),
        )}
      </SettingsSection>

      {boards.map((environment) => {
        const providers = (providersByEnvironment.get(environment.environmentId) ?? []).filter(
          (provider) => provider.enabled && provider.installed,
        );
        const options: ReadonlyArray<readonly [string, string]> = [
          [DEFAULT_MODEL, gt("The project's default model")],
          ...providers.flatMap((provider) =>
            provider.models.map(
              (model) =>
                [
                  `${provider.instanceId}${SEPARATOR}${model.slug}`,
                  `${provider.displayName ?? provider.instanceId} · ${model.name}`,
                ] as const,
            ),
          ),
        ];
        const picks = models[environment.environmentId];
        const valueOf = (role: TackModelRole) => {
          const pick = picks?.[role];
          const value =
            pick == null ? DEFAULT_MODEL : `${pick.instanceId}${SEPARATOR}${pick.model}`;
          return options.some(([option]) => option === value) ? value : DEFAULT_MODEL;
        };
        const choose = (role: TackModelRole) => (value: string) => {
          const [instanceId, model] = value.split(SEPARATOR);
          setModels((previous) => ({
            ...previous,
            [environment.environmentId]: {
              ...previous[environment.environmentId],
              [role]:
                value === DEFAULT_MODEL || instanceId === undefined || model === undefined
                  ? null
                  : { instanceId, model },
            },
          }));
        };
        return (
          <SettingsSection
            key={environment.environmentId}
            id={`tack-model-${environment.environmentId}`}
            title={
              boards.length > 1
                ? gt("AI model on {environment}", { environment: environment.label })
                : gt("AI model")
            }
          >
            {row(
              gt("Tack on the board"),
              gt(
                "The model that answers when you talk to Tack on a board. Used from Tack's next new chat.",
              ),
              <Choice
                wide
                label={gt("Tack on the board")}
                value={valueOf("board")}
                onChange={choose("board")}
                options={options}
              />,
            )}
            {row(
              gt("Tack in an open task or module"),
              gt(
                "The model for a chat started from inside a task, and for Continue. A thread already running keeps its own.",
              ),
              <Choice
                wide
                label={gt("Tack in an open task or module")}
                value={valueOf("task")}
                onChange={choose("task")}
                options={options}
              />,
            )}
          </SettingsSection>
        );
      })}
    </SettingsPageContainer>
  );
}
