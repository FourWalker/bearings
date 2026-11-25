import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { boardEnvironment } from "~/state/board";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

export function BoardFileActions(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string | null;
  readonly hasArchivedThreads: boolean;
  readonly onOpened: (boardId: string) => void;
}) {
  const gt = useGT();
  const canOpen = useAtomValue(boardEnvironment.openFile.permissionAtom(props.environmentId));
  const canExport = useAtomValue(boardEnvironment.exportFile.permissionAtom(props.environmentId));
  const canReadArchive = useAtomValue(
    boardEnvironment.archivedThreads.permissionAtom(props.environmentId),
  );
  const readArchive = useAtomCommand(boardEnvironment.archivedThreads, { reportFailure: false });
  const [archive, setArchive] = useState<ReadonlyArray<OrchestrationV2ThreadTranscript> | null>(
    null,
  );
  const [threadIndex, setThreadIndex] = useState(0);
  const selectedThread = archive?.[threadIndex];
  const openFile = useAtomCommand(boardEnvironment.openFile, { reportFailure: false });
  const exportFile = useAtomCommand(boardEnvironment.exportFile, { reportFailure: false });
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const showArchive = canReadArchive && props.hasArchivedThreads && props.boardId !== null;
  if (!canOpen && !showArchive && (!canExport || props.boardId === null)) return null;

  async function openArchive() {
    const { boardId, environmentId } = props;
    if (boardId === null) return;
    setBusy(true);
    try {
      const result = await readArchive({ environmentId, input: { boardId } });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: gt("Could not open archived threads"),
          description: formatEnvironmentQueryError(result.cause),
        });
      } else {
        setThreadIndex(0);
        setArchive(result.value);
      }
    } finally {
      setBusy(false);
    }
  }

  async function open(file: File) {
    setBusy(true);
    try {
      const result = await openFile({
        environmentId: props.environmentId,
        input: { contents: await file.text() },
      });
      if (result._tag === "Failure") {
        throw new Error(formatEnvironmentQueryError(result.cause));
      }
      props.onOpened(result.value);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Could not open the board file"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(includeThreads: boolean) {
    const { boardId, environmentId } = props;
    if (boardId === null) return;
    setBusy(true);
    try {
      const result = await exportFile({ environmentId, input: { boardId, includeThreads } });
      if (result._tag === "Failure") {
        throw new Error(formatEnvironmentQueryError(result.cause));
      }
      const url = URL.createObjectURL(new Blob([result.value], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${boardId}.t3board`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Could not export the board"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex shrink-0 gap-2 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      {canOpen && (
        <>
          <input
            hidden
            ref={picker}
            type="file"
            accept=".t3board"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void open(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <T>Open Board File</T>
          </Button>
        </>
      )}
      {showArchive && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void openArchive()}>
          <T>Archived threads</T>
        </Button>
      )}
      <Dialog
        open={archive !== null}
        onOpenChange={(open) => {
          if (!open) setArchive(null);
        }}
      >
        <DialogPopup className="max-h-[90dvh] w-[min(96vw,48rem)] sm:max-w-none">
          <DialogTitle className="mx-5 mt-5">
            <T>Archived threads</T>
          </DialogTitle>
          {archive !== null && (
            <div className="grid gap-4 overflow-y-auto p-5">
              <select
                aria-label={gt("Archived thread")}
                className="rounded-md border bg-background p-2 text-sm"
                value={threadIndex}
                onChange={(event) => setThreadIndex(Number(event.currentTarget.value))}
              >
                {archive.map((thread, index) => (
                  <option key={thread.threadId} value={index}>
                    {thread.title || thread.threadId}
                  </option>
                ))}
              </select>
              {selectedThread?.items.map(({ position, item }) => (
                <details
                  key={position}
                  open={item.type === "user_message" || item.type === "assistant_message"}
                >
                  <summary className="cursor-pointer font-medium">
                    {item.type.replaceAll("_", " ")}
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {item.type === "user_message" || item.type === "assistant_message"
                      ? item.text
                      : JSON.stringify(item, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </DialogPopup>
      </Dialog>
      {canExport && props.boardId !== null && (
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
            <T>Export Board</T>
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => void save(false)}>
              <T>Board only</T>
            </MenuItem>
            <MenuItem onClick={() => void save(true)}>
              <T>Board and thread transcripts</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}
