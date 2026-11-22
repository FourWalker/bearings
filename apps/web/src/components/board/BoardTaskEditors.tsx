import type { BoardTask, BoardTaskEdit, EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { boardEnvironment } from "~/state/board";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Project Board fork: the board app's edit controls for the task views. Each change is one
 * `board.editTask` call; the view refreshes from the board once it's saved.
 */
interface BoardEdit {
  readonly canEdit: boolean;
  /** Saves one change to `taskId` (the open task by default); false when it failed. */
  readonly edit: (change: BoardTaskEdit, taskId?: string) => Promise<boolean>;
}

const BoardEditContext = createContext<BoardEdit>({
  canEdit: false,
  edit: () => Promise.resolve(false),
});

export const useBoardEdit = () => useContext(BoardEditContext);

export function BoardEditProvider(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly taskId: string;
  readonly onSaved: (createdId: string | null, change: BoardTaskEdit) => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const canEdit = useAtomValue(boardEnvironment.editTask.permissionAtom(props.environmentId));
  const run = useAtomCommand(boardEnvironment.editTask, { reportFailure: false });
  const edit = async (change: BoardTaskEdit, taskId = props.taskId) => {
    const result = await run({
      environmentId: props.environmentId,
      input: { boardId: props.boardId, taskId, edit: change },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Could not save the change"),
        description: formatEnvironmentQueryError(result.cause),
      });
      return false;
    }
    props.onSaved(result.value.createdId, change);
    return true;
  };
  return (
    <BoardEditContext.Provider value={{ canEdit, edit }}>
      {props.children}
    </BoardEditContext.Provider>
  );
}

/** A select over fixed choices, sized for the task views. */
export function ChoiceSelect<V extends string>(props: {
  readonly value: V;
  readonly choices: ReadonlyArray<readonly [V, string]>;
  readonly onChange: (value: V) => void;
  readonly label: string;
  readonly disabled?: boolean;
  /** Its width: the trigger fills it. */
  readonly width?: "sm" | "md" | "full";
}) {
  return (
    <div
      className={
        props.width === "full"
          ? "min-w-0"
          : props.width === "sm"
            ? "w-28 shrink-0"
            : "w-44 shrink-0"
      }
    >
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) props.onChange(value as V);
        }}
        items={props.choices.map(([value, label]) => ({ value, label }))}
        disabled={props.disabled ?? false}
      >
        <SelectTrigger size="sm" aria-label={props.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {props.choices.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

/** Text that turns into a field to edit, saved on Enter or leaving it. */
export function EditableText(props: {
  readonly value: string;
  readonly label: string;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly onSave: (value: string) => void;
  readonly children: ReactNode;
}) {
  const { canEdit } = useBoardEdit();
  const [draft, setDraft] = useState<string | null>(null);
  if (!canEdit) return props.children;
  if (draft === null)
    return (
      <button
        type="button"
        className="w-full rounded text-start hover:bg-accent/50"
        aria-label={props.label}
        onClick={() => setDraft(props.value)}
      >
        {props.children}
      </button>
    );
  const done = () => {
    if (draft !== props.value) props.onSave(draft);
    setDraft(null);
  };
  return props.multiline ? (
    <Textarea
      autoFocus
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={done}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDraft(null);
      }}
    />
  ) : (
    <Input
      autoFocus
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={done}
      onKeyDown={(event) => {
        if (event.key === "Enter") done();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** A Markdown document with an Edit button that swaps in a text area. */
export function MarkdownEditor(props: {
  readonly value: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly onSave: (markdown: string) => Promise<boolean>;
  readonly children: ReactNode;
  readonly editLabel?: string;
}) {
  const gt = useGT();
  const { canEdit } = useBoardEdit();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null)
    return (
      <div className="grid gap-2">
        <Textarea
          autoFocus
          aria-label={props.label}
          placeholder={props.placeholder}
          className="min-h-64"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="xs"
            onClick={() => void props.onSave(draft).then((ok) => ok && setDraft(null))}
          >
            <T>Save</T>
          </Button>
          <Button variant="outline" size="xs" onClick={() => setDraft(null)}>
            <T>Cancel</T>
          </Button>
        </div>
      </div>
    );
  return (
    <>
      {props.children}
      {canEdit ? (
        <div>
          <Button variant="outline" size="xs" onClick={() => setDraft(props.value)}>
            {props.editLabel ?? (props.value ? gt("Edit") : gt("Write"))}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** A one-line form: a field and an Add button, cleared once saved. */
export function AddRow(props: {
  readonly placeholder: string;
  readonly button: string;
  readonly before?: ReactNode;
  readonly onAdd: (text: string) => Promise<boolean>;
}) {
  const { canEdit } = useBoardEdit();
  const [text, setText] = useState("");
  if (!canEdit) return null;
  const submit = () => {
    if (!text.trim()) return;
    void props.onAdd(text.trim()).then((ok) => ok && setText(""));
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {props.before}
      <Input
        size="sm"
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" variant="outline" size="xs" disabled={!text.trim()}>
        <PlusIcon />
        {props.button}
      </Button>
    </form>
  );
}

/** A must-do or to-do with its checkbox, and remove when editing is allowed. */
export function ItemRow(props: {
  readonly item: BoardTask["items"][number];
  readonly taskId: string;
  readonly children?: ReactNode;
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const { item } = props;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={item.done}
        disabled={!canEdit}
        aria-label={item.text}
        onCheckedChange={() => void edit({ op: "toggleItem", itemId: item.id }, props.taskId)}
      />
      <span className={item.done ? "flex-1 line-through opacity-60" : "flex-1"}>
        {item.text}
        {props.children}
      </span>
      {canEdit ? (
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label={gt("Delete")}
          onClick={() => void edit({ op: "deleteItem", itemId: item.id }, props.taskId)}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

/** Adds a must-do or to-do to the task. */
export function ItemAdder(props: { readonly taskId: string }) {
  const gt = useGT();
  const { edit } = useBoardEdit();
  const [kind, setKind] = useState<"mandatory" | "todo">("todo");
  return (
    <AddRow
      placeholder={gt("Add…")}
      button={gt("Add")}
      before={
        <ChoiceSelect
          value={kind}
          label={gt("Item kind")}
          choices={[
            ["mandatory", gt("Mandatory")],
            ["todo", gt("To do")],
          ]}
          onChange={setKind}
        />
      }
      onAdd={(text) => edit({ op: "addItem", kind, text }, props.taskId)}
    />
  );
}

const DOC_KINDS = [
  "Tech spec",
  "HLD",
  "LLD",
  "API spec",
  "Design",
  "Runbook",
  "Reference",
  "Other",
] as const;

/** Maps a document to the task by path or URL. */
export function DocAdder() {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [kind, setKind] = useState<string>("Tech spec");
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  if (!canEdit) return null;
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ref.trim()) return;
        void edit({ op: "addDoc", kind, title, ref, note }).then((ok) => {
          if (!ok) return;
          setTitle("");
          setRef("");
          setNote("");
        });
      }}
    >
      <ChoiceSelect
        value={kind}
        label={gt("Document kind")}
        choices={DOC_KINDS.map((k) => [k, k] as const)}
        onChange={setKind}
      />
      <Input
        size="sm"
        placeholder={gt("Title (optional)")}
        aria-label={gt("Title (optional)")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Input
        size="sm"
        placeholder={gt("File path or URL")}
        aria-label={gt("File path or URL")}
        spellCheck={false}
        value={ref}
        onChange={(event) => setRef(event.target.value)}
      />
      <Input
        size="sm"
        placeholder={gt("What it covers / when to read it")}
        aria-label={gt("What it covers / when to read it")}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="submit" variant="outline" size="xs" disabled={!ref.trim()}>
        <PlusIcon />
        <T>Add</T>
      </Button>
    </form>
  );
}

type LinkKind = "blocked_by" | "blocks" | "found_during" | "led_to" | "related" | "fixes";

/** Links the task to one outside its tree. */
export function LinkAdder(props: {
  readonly targets: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [type, setType] = useState<LinkKind>("blocked_by");
  const [to, setTo] = useState<string>("");
  const first = props.targets[0];
  if (!canEdit || first === undefined) return null;
  const target = props.targets.some((t) => t.id === to) ? to : first.id;
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void edit({ op: "addLink", to: target, type, note: "" });
      }}
    >
      <ChoiceSelect
        value={type}
        label={gt("Link kind")}
        choices={[
          ["blocked_by", gt("is blocked by")],
          ["blocks", gt("blocks")],
          ["found_during", gt("was found during")],
          ["led_to", gt("led to")],
          ["related", gt("is related to")],
          ["fixes", gt("fixes (bug in)")],
        ]}
        onChange={setType}
      />
      <ChoiceSelect
        value={target}
        width="full"
        label={gt("Linked task")}
        choices={props.targets.map((t) => [t.id, t.label] as const)}
        onChange={setTo}
      />
      <div>
        <Button type="submit" variant="outline" size="xs">
          <T>Link</T>
        </Button>
      </div>
    </form>
  );
}

/** Files a new decision at the level it affects. */
export function DecisionAdder(props: {
  readonly levels: ReadonlyArray<readonly [1 | 2 | 3, string]>;
  readonly registers: ReadonlyArray<{ readonly id: string; readonly topic: string }>;
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState("");
  const [refs, setRefs] = useState("");
  const [recommendation, setRecommendation] = useState(false);
  const [area, setArea] = useState("");
  const [lldCheck, setLldCheck] = useState("");
  const [register, setRegister] = useState("");
  const [first] = props.levels;
  const [level, setLevel] = useState<string>(String(first?.[0] ?? 3));
  if (!canEdit) return null;
  return (
    <form
      className="grid gap-2 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        void edit({
          op: "addDecision",
          title,
          description,
          options,
          refs: refs
            .split(/\r?\n/)
            .map((r) => r.trim())
            .filter(Boolean),
          level: Number(level) as 1 | 2 | 3,
          ...(recommendation
            ? { recommendation: { area, lldCheck, register: register || null } }
            : {}),
        }).then((ok) => {
          if (!ok) return;
          setTitle("");
          setDescription("");
          setOptions("");
          setRefs("");
          setArea("");
          setLldCheck("");
          setRegister("");
          setRecommendation(false);
        });
      }}
    >
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        <T>New decision</T>
      </h3>
      <Input
        size="sm"
        placeholder={gt("The question to decide")}
        aria-label={gt("The question to decide")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        placeholder={gt("Context: what's being decided and why it matters")}
        aria-label={gt("Context")}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Textarea
        placeholder={gt("Options / recommendation (optional)")}
        aria-label={gt("Options / recommendation (optional)")}
        value={options}
        onChange={(event) => setOptions(event.target.value)}
      />
      <Textarea
        placeholder={gt("References, one per line: handoff paths, docs, URLs (optional)")}
        aria-label={gt("References")}
        value={refs}
        onChange={(event) => setRefs(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={recommendation}
          onCheckedChange={(checked) => setRecommendation(checked === true)}
        />
        <T>Recommendation for the register (gets an R#)</T>
      </label>
      {recommendation ? (
        <>
          <Input
            size="sm"
            placeholder={gt("Area")}
            aria-label={gt("Area")}
            value={area}
            onChange={(event) => setArea(event.target.value)}
          />
          <Input
            size="sm"
            placeholder={gt("LLD check (optional)")}
            aria-label={gt("LLD check (optional)")}
            value={lldCheck}
            onChange={(event) => setLldCheck(event.target.value)}
          />
          {props.registers.length > 0 ? (
            <ChoiceSelect
              value={register}
              label={gt("External register")}
              choices={[
                ["", gt("Board register")],
                ...props.registers.map(({ id, topic }) => [id, topic] as const),
              ]}
              onChange={setRegister}
            />
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          <T>File at</T>
        </span>
        <ChoiceSelect
          value={level}
          label={gt("Level to file it at")}
          choices={props.levels.map(([l, label]) => [String(l), label] as const)}
          onChange={setLevel}
        />
        <Button type="submit" size="xs" disabled={!title.trim()}>
          <T>Add decision</T>
        </Button>
      </div>
    </form>
  );
}

/** Records the verdict on an open decision, or drops it; reopens a settled one. */
export function VerdictControls(props: {
  readonly decisionId: string;
  readonly status: "open" | "decided" | "dropped";
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [verdict, setVerdict] = useState("");
  if (!canEdit) return null;
  if (props.status !== "open")
    return (
      <div>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void edit({ op: "setDecision", decisionId: props.decisionId, action: "reopen" })
          }
        >
          <T>Reopen</T>
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!verdict.trim()) return;
        void edit({
          op: "setDecision",
          decisionId: props.decisionId,
          action: "decide",
          verdict,
        }).then((ok) => ok && setVerdict(""));
      }}
    >
      <Input
        size="sm"
        className="min-w-48 flex-1"
        placeholder={gt("Verdict (what was decided, by whom)…")}
        aria-label={gt("Verdict")}
        value={verdict}
        onChange={(event) => setVerdict(event.target.value)}
      />
      <Button type="submit" size="xs" disabled={!verdict.trim()}>
        <T>Decide</T>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() =>
          void edit({ op: "setDecision", decisionId: props.decisionId, action: "drop", verdict })
        }
      >
        <T>Drop</T>
      </Button>
    </form>
  );
}

/** Moves the task under another master task or module, or to the top level. */
export function MoveMenu(props: {
  readonly targets: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly canBeTopLevel: boolean;
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  if (!canEdit) return null;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="xs" />}>
        <T>Move…</T>
      </MenuTrigger>
      <MenuPopup align="end" className="max-h-80 overflow-y-auto">
        {props.canBeTopLevel ? (
          <MenuItem onClick={() => void edit({ op: "move", parentId: null })}>
            {gt("Top level (master task)")}
          </MenuItem>
        ) : null}
        {props.targets.map((target) => (
          <MenuItem key={target.id} onClick={() => void edit({ op: "move", parentId: target.id })}>
            {target.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Owner of the task's module or master task: assign a workspace copy, hand over, take back. */
export function WorkspaceControls(props: {
  readonly workspaces: ReadonlyArray<{ readonly root: string; readonly label: string }>;
  readonly owner: { readonly root: string; readonly state: "owned" | "soft" } | null;
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  if (!canEdit) return null;
  const NOBODY = "\u0000";
  return (
    <div className="grid gap-2">
      <ChoiceSelect
        value={props.owner?.root ?? NOBODY}
        width="full"
        label={gt("Owning workspace")}
        choices={[
          [NOBODY, props.owner ? gt("Release (nobody)") : gt("Nobody owns it")],
          ...props.workspaces.map((w) => [w.root, w.label] as const),
        ]}
        onChange={(root) => void edit({ op: "setOwner", root: root === NOBODY ? null : root })}
      />
      {props.owner?.state === "owned" ? (
        <div>
          <Button variant="outline" size="xs" onClick={() => void edit({ op: "softRelease" })}>
            <T>Soft release</T>
          </Button>
        </div>
      ) : props.owner?.state === "soft" ? (
        <div>
          <Button variant="outline" size="xs" onClick={() => void edit({ op: "reclaim" })}>
            <T>Reclaim</T>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Edits a decision's question, context, options and references. */
export function DecisionTextEditor(props: {
  readonly decision: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly options: string;
    readonly refs: ReadonlyArray<string>;
  };
}) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    options: string;
    refs: string;
  } | null>(null);
  if (!canEdit) return null;
  const d = props.decision;
  if (draft === null)
    return (
      <div>
        <Button
          variant="ghost-muted"
          size="xs"
          onClick={() =>
            setDraft({
              title: d.title,
              description: d.description,
              options: d.options,
              refs: d.refs.join("\n"),
            })
          }
        >
          <T>Edit</T>
        </Button>
      </div>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void edit({
          op: "updateDecision",
          decisionId: d.id,
          title: draft.title,
          description: draft.description,
          options: draft.options,
          refs: draft.refs
            .split(/\r?\n/)
            .map((r) => r.trim())
            .filter(Boolean),
        }).then((ok) => ok && setDraft(null));
      }}
    >
      <Input
        size="sm"
        aria-label={gt("The question to decide")}
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <Textarea
        aria-label={gt("Context")}
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
      />
      <Textarea
        aria-label={gt("Options / recommendation (optional)")}
        value={draft.options}
        onChange={(event) => setDraft({ ...draft, options: event.target.value })}
      />
      <Textarea
        aria-label={gt("References")}
        value={draft.refs}
        onChange={(event) => setDraft({ ...draft, refs: event.target.value })}
      />
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={!draft.title.trim()}>
          <T>Save</T>
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setDraft(null)}>
          <T>Cancel</T>
        </Button>
      </div>
    </form>
  );
}

/** Records how a decided recommendation was built. */
export function ImplementedForm(props: { readonly decisionId: string }) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ problem: "", approach: "", api: "", code: "", tests: "" });
  if (!canEdit) return null;
  if (!open)
    return (
      <div>
        <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
          <T>Record how it was implemented</T>
        </Button>
      </div>
    );
  const field = (key: keyof typeof fields, label: string) => (
    <Input
      size="sm"
      placeholder={label}
      aria-label={label}
      value={fields[key]}
      onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
    />
  );
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void edit({ op: "implemented", decisionId: props.decisionId, ...fields }).then(
          (ok) => ok && setOpen(false),
        );
      }}
    >
      {field("problem", gt("Problem"))}
      {field("approach", gt("Approach"))}
      {field("api", gt("New API (method, path, purpose, responses)"))}
      {field("code", gt("Code (repo, branch, commit, classes)"))}
      {field("tests", gt("Tests"))}
      <div className="flex gap-2">
        <Button type="submit" size="xs">
          <T>Save</T>
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setOpen(false)}>
          <T>Cancel</T>
        </Button>
      </div>
    </form>
  );
}
