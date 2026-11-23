import { useAtomValue } from "@effect/atom-react";
import type { BoardSettings, BoardSettingsEdit, EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PlusIcon, SettingsIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { boardEnvironment } from "~/state/board";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Project Board fork: the board app's ⚙. The board's name, its workspace copies, the services
 * that tag tasks by folder, project rules, Board Mode and external registers.
 */
export function BoardSettingsButton(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const allowed = useAtomValue(boardEnvironment.editBoard.permissionAtom(props.environmentId));
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button
        data-board-settings
        variant="ghost-muted"
        size="icon-sm"
        aria-label={gt("Board settings")}
        onClick={() => setOpen(true)}
      >
        <SettingsIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-h-[90dvh] w-[min(96vw,48rem)] sm:max-w-none">
          <DialogTitle className="mx-5 mt-5">
            <T>Board settings</T>
          </DialogTitle>
          {open ? <SettingsBody {...props} /> : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function SettingsBody(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    boardEnvironment.settings({
      environmentId: props.environmentId,
      input: { boardId: props.boardId },
    }),
  );
  const run = useAtomCommand(boardEnvironment.editBoard, { reportFailure: false });
  const save = async (edit: BoardSettingsEdit) => {
    const result = await run({
      environmentId: props.environmentId,
      input: { boardId: props.boardId, edit },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Could not save the board settings"),
        description: formatEnvironmentQueryError(result.cause),
      });
      return false;
    }
    query.refresh();
    props.onChanged();
    return true;
  };
  const settings = query.data;
  if (settings === null)
    return query.error !== null ? (
      <p className="p-5 text-destructive text-sm">{query.error}</p>
    ) : (
      <div className="p-5">
        <Skeleton className="h-40" />
      </div>
    );
  return (
    // Keyed by the saved settings, so each section's draft restarts from what was saved.
    <div key={JSON.stringify(settings)} className="grid gap-5 overflow-y-auto p-5">
      <NameSection settings={settings} save={save} />
      <WorkspacesSection settings={settings} save={save} />
      <ServicesSection settings={settings} save={save} />
      <Section title={gt("Project rules")}>
        <RulesEditor settings={settings} save={save} />
      </Section>
      <Section title={gt("Board Mode")}>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={settings.boardMode}
            aria-label={gt("Board Mode")}
            onCheckedChange={(checked) => void save({ op: "setBoardMode", on: Boolean(checked) })}
          />
          <span className="text-muted-foreground">
            <T>
              Threads resume from the living handoff, checkpoint at phase ends, file decisions at
              the right level, and follow the board's protocol.
            </T>
          </span>
        </label>
      </Section>
      <RegistersSection settings={settings} save={save} />
    </div>
  );
}

type Save = (edit: BoardSettingsEdit) => Promise<boolean>;

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3
        data-board-card-title
        className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function NameSection(props: { readonly settings: BoardSettings; readonly save: Save }) {
  const gt = useGT();
  const [name, setName] = useState(props.settings.name);
  return (
    <Section title={gt("Name")}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void props.save({ op: "rename", name });
        }}
      >
        <Input
          size="sm"
          aria-label={gt("Board name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="xs" disabled={!name.trim() || name === props.settings.name}>
          <T>Rename</T>
        </Button>
      </form>
    </Section>
  );
}

function WorkspacesSection(props: { readonly settings: BoardSettings; readonly save: Save }) {
  const gt = useGT();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  return (
    <Section title={gt("Workspaces")}>
      <p className="text-muted-foreground text-xs">
        <T>
          Each copy of the project this board spans. A thread in any of these folders reports to
          this board.
        </T>
      </p>
      {props.settings.roots.map((root) => (
        <div key={root.path} className="flex items-center gap-2">
          <Input
            size="sm"
            aria-label={gt("Workspace label")}
            defaultValue={root.label}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== root.label)
                void props.save({ op: "labelRoot", path: root.path, label: next });
            }}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
            {root.path}
          </span>
          {props.settings.roots.length > 1 ? (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Remove workspace {label}", { label: root.label })}
              onClick={() => void props.save({ op: "removeRoot", path: root.path })}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!path.trim()) return;
          void props.save({ op: "addRoot", path, label }).then((ok) => {
            if (!ok) return;
            setPath("");
            setLabel("");
          });
        }}
      >
        <Input
          size="sm"
          placeholder={gt("Folder on this machine")}
          aria-label={gt("Folder on this machine")}
          spellCheck={false}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Input
          size="sm"
          placeholder={gt("Label (optional)")}
          aria-label={gt("Label (optional)")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" variant="outline" size="xs" disabled={!path.trim()}>
          <PlusIcon />
          <T>Add</T>
        </Button>
      </form>
    </Section>
  );
}

function ServicesSection(props: { readonly settings: BoardSettings; readonly save: Save }) {
  const gt = useGT();
  const [rows, setRows] = useState(
    props.settings.services.map((s) => ({ id: s.id, name: s.name, match: s.match.join(", ") })),
  );
  const changed =
    JSON.stringify(rows) !==
    JSON.stringify(
      props.settings.services.map((s) => ({ id: s.id, name: s.name, match: s.match.join(", ") })),
    );
  return (
    <Section title={gt("Services")}>
      <p className="text-muted-foreground text-xs">
        <T>
          A thread that edits files under a service's folders tags its task with that service.
          Folders are relative to each workspace, comma-separated.
        </T>
      </p>
      {rows.map((row, i) => (
        <div key={row.id || `new-${i}`} className="flex items-center gap-2">
          <Input
            size="sm"
            placeholder={gt("Service name")}
            aria-label={gt("Service name")}
            value={row.name}
            onChange={(event) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, name: event.target.value } : r)))
            }
          />
          <Input
            size="sm"
            placeholder={gt("Folders, e.g. BE/invoice-service")}
            aria-label={gt("Service folders")}
            spellCheck={false}
            value={row.match}
            onChange={(event) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, match: event.target.value } : r)))
            }
          />
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Remove service")}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => setRows([...rows, { id: "", name: "", match: "" }])}
        >
          <PlusIcon />
          <T>Add service</T>
        </Button>
        <Button
          size="xs"
          disabled={!changed}
          onClick={() =>
            void props.save({
              op: "saveServices",
              services: rows.map((r) => ({
                ...(r.id ? { id: r.id } : {}),
                name: r.name,
                match: r.match.split(","),
              })),
            })
          }
        >
          <T>Save services</T>
        </Button>
      </div>
    </Section>
  );
}

function RulesEditor(props: { readonly settings: BoardSettings; readonly save: Save }) {
  const gt = useGT();
  const [rules, setRules] = useState(props.settings.rules);
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-xs">
        <T>Rules every thread on this board follows, added to its context with Board Mode on.</T>
      </p>
      <Textarea
        aria-label={gt("Project rules")}
        className="min-h-32"
        value={rules}
        onChange={(event) => setRules(event.target.value)}
      />
      <div>
        <Button
          size="xs"
          disabled={rules === props.settings.rules}
          onClick={() => void props.save({ op: "saveRules", rules })}
        >
          <T>Save rules</T>
        </Button>
      </div>
    </div>
  );
}

function RegistersSection(props: { readonly settings: BoardSettings; readonly save: Save }) {
  const gt = useGT();
  const [rows, setRows] = useState(props.settings.registers.map((r) => ({ ...r })));
  const changed = JSON.stringify(rows) !== JSON.stringify(props.settings.registers);
  return (
    <Section title={gt("Existing registers")}>
      <p className="text-muted-foreground text-xs">
        <T>
          Topics with their own recommendations register elsewhere; recommendations on them keep the
          same R# there.
        </T>
      </p>
      {rows.map((row, i) => (
        <div key={row.id || `new-${i}`} className="flex items-center gap-2">
          <Input
            size="sm"
            placeholder={gt("Topic")}
            aria-label={gt("Register topic")}
            value={row.topic}
            onChange={(event) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, topic: event.target.value } : r)))
            }
          />
          <Input
            size="sm"
            placeholder={gt("Register URL")}
            aria-label={gt("Register URL")}
            spellCheck={false}
            value={row.url}
            onChange={(event) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, url: event.target.value } : r)))
            }
          />
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Remove register")}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => setRows([...rows, { id: "", topic: "", url: "" }])}
        >
          <PlusIcon />
          <T>Add register</T>
        </Button>
        <Button
          size="xs"
          disabled={!changed}
          onClick={() =>
            void props.save({
              op: "saveRegisters",
              registers: rows.map((r) => ({
                ...(r.id ? { id: r.id } : {}),
                topic: r.topic,
                url: r.url,
              })),
            })
          }
        >
          <T>Save registers</T>
        </Button>
      </div>
    </Section>
  );
}
