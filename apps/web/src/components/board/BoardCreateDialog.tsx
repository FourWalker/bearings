import type { BoardWorkspaceCandidate, EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { boardEnvironment } from "~/state/board";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

/** Project Board fork: a new board, named and bound to its workspace folders in one step. */
export function BoardCreateDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (boardId: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-h-[90dvh] w-[min(96vw,40rem)] sm:max-w-none">
        <DialogTitle className="mx-5 mt-5">
          <T>New board</T>
        </DialogTitle>
        {props.open ? (
          <CreateBody
            environmentId={props.environmentId}
            onCancel={() => props.onOpenChange(false)}
            onCreated={props.onCreated}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

interface FolderRow {
  readonly path: string;
  readonly label: string;
}

function CreateBody(props: {
  readonly environmentId: EnvironmentId;
  readonly onCancel: () => void;
  readonly onCreated: (boardId: string) => void;
}) {
  const gt = useGT();
  const candidates = useEnvironmentQuery(
    boardEnvironment.workspaceCandidates({ environmentId: props.environmentId, input: {} }),
  );
  const create = useAtomCommand(boardEnvironment.createBoard, { reportFailure: false });
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [folders, setFolders] = useState<ReadonlyArray<FolderRow>>([]);
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [boardMode, setBoardMode] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addFolder = () => {
    if (!path.trim()) return;
    setFolders([...folders, { path: path.trim(), label: label.trim() }]);
    setPath("");
    setLabel("");
    setError(null);
  };
  const submit = async () => {
    const typed = path.trim() ? [{ path: path.trim(), label: label.trim() }] : [];
    const roots = [
      ...(candidates.data ?? [])
        .filter((candidate) => picked.includes(candidate.path))
        .map((candidate) => ({ path: candidate.path, label: candidate.title })),
      ...folders,
      ...typed,
    ];
    if (!name.trim()) return setError(gt("Enter a name for the board."));
    if (roots.length === 0) return setError(gt("Pick at least one workspace."));
    setBusy(true);
    const result = await create({
      environmentId: props.environmentId,
      input: { name, roots, boardMode },
    });
    setBusy(false);
    if (result._tag === "Failure") return setError(formatEnvironmentQueryError(result.cause));
    props.onCreated(result.value.boardId);
  };

  return (
    <form
      className="grid gap-5 overflow-y-auto p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-2">
        <FieldTitle>
          <T>Name</T>
        </FieldTitle>
        <Input
          size="sm"
          autoFocus
          aria-label={gt("Board name")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>
      <section className="grid gap-2">
        <FieldTitle>
          <T>Workspaces</T>
        </FieldTitle>
        <p className="text-muted-foreground text-xs">
          <T>Folders this board spans. A thread in any of them reports to this board.</T>
        </p>
        {candidates.data === null ? (
          candidates.error !== null ? (
            <p className="text-destructive text-xs">{candidates.error}</p>
          ) : (
            <Skeleton className="h-24" />
          )
        ) : (
          <WorkspaceCandidateList
            candidates={candidates.data}
            picked={picked}
            onToggle={(candidatePath, on) => {
              setPicked(
                on ? [...picked, candidatePath] : picked.filter((entry) => entry !== candidatePath),
              );
              setError(null);
            }}
          />
        )}
        {folders.map((folder) => (
          <div key={folder.path} className="flex items-center gap-2 text-sm">
            <span className="shrink-0">{folder.label || gt("Folder")}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
              {folder.path}
            </span>
            <Badge variant="warning" size="sm">
              <T>Project will be added</T>
            </Badge>
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Remove folder {path}", { path: folder.path })}
              onClick={() => setFolders(folders.filter((entry) => entry.path !== folder.path))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            placeholder={gt("Another folder on this machine")}
            aria-label={gt("Another folder on this machine")}
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
          <Button variant="outline" size="xs" disabled={!path.trim()} onClick={addFolder}>
            <PlusIcon />
            <T>Add</T>
          </Button>
        </div>
      </section>
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={boardMode}
          aria-label={gt("Board Mode")}
          onCheckedChange={(checked) => setBoardMode(Boolean(checked))}
        />
        <span className="grid">
          <T>Board Mode</T>
          <span className="text-muted-foreground text-xs">
            <T>Threads resume from the handoff and follow the board's protocol.</T>
          </span>
        </span>
      </label>
      {error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <span className="text-muted-foreground text-xs">
          <T>Services, rules and registers come after, in board settings.</T>
        </span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onCancel}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            <T>Create board</T>
          </Button>
        </span>
      </div>
    </form>
  );
}

function FieldTitle(props: { readonly children: React.ReactNode }) {
  return (
    <span
      data-board-card-title
      className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
    >
      {props.children}
    </span>
  );
}

/** The server's T3 projects as tick rows; one on another board can't be picked. */
function WorkspaceCandidateList(props: {
  readonly candidates: ReadonlyArray<BoardWorkspaceCandidate>;
  readonly picked: ReadonlyArray<string>;
  readonly onToggle: (path: string, on: boolean) => void;
}) {
  const gt = useGT();
  if (props.candidates.length === 0)
    return (
      <p className="text-muted-foreground text-xs">
        <T>This server has no T3 projects yet. Enter a folder below.</T>
      </p>
    );
  return (
    <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
      {props.candidates.map((candidate) => (
        <li key={candidate.projectId}>
          <label className="flex items-center gap-3 px-3 py-2 text-sm">
            <Checkbox
              checked={props.picked.includes(candidate.path)}
              disabled={candidate.board !== null}
              aria-label={candidate.title}
              onCheckedChange={(checked) => props.onToggle(candidate.path, Boolean(checked))}
            />
            <span className="grid min-w-0 flex-1">
              <span className="truncate">{candidate.title}</span>
              <span className="truncate font-mono text-muted-foreground text-xs">
                {candidate.path}
              </span>
            </span>
            {candidate.board !== null ? (
              <span className="shrink-0 text-muted-foreground text-xs">
                {gt("On the {board} board", { board: candidate.board.name })}
              </span>
            ) : null}
          </label>
        </li>
      ))}
    </ul>
  );
}
