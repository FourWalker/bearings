import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type BoardIntent, type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { getClientId } from "~/lib/backgroundActivityReporter";
import { boardEnvironment } from "~/state/board";
import { useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { boardSearchOfIntent } from "./board.logic";
import { tackShow } from "./tackShow";

/**
 * Project Board fork: does what a board tool asked this window to show, and answers whether it
 * could. Commands only navigate or pre-fill a composer; nothing here writes board data.
 */
export function BoardIntentListener() {
  const { environments } = useEnvironments();
  return environments
    .filter((environment) => environment.serverConfig?.environment.capabilities.projectBoard)
    .map((environment) => (
      <BoardIntentChannel
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
    ));
}

function BoardIntentChannel(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const router = useRouter();
  const acknowledge = useAtomCommand(boardEnvironment.ackIntent, { reportFailure: false });
  const latest = useAtomValue(
    boardEnvironment.intents({ environmentId, input: { clientId: getClientId() } }),
  );
  const done = useRef<string | null>(null);
  const intent = AsyncResult.isSuccess(latest) ? latest.value : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a server event to act on once: it moves the router, which lives outside React state.
  useEffect(() => {
    if (intent === null || done.current === intent.id) return;
    done.current = intent.id;
    void perform(intent.command).then(
      () => acknowledge({ environmentId, input: { id: intent.id, ok: true } }),
      (cause: unknown) =>
        acknowledge({
          environmentId,
          input: { id: intent.id, ok: false, detail: String(cause) },
        }),
    );

    async function perform(command: BoardIntent["command"]) {
      switch (command.type) {
        case "board.open": {
          // Tack walks to the note instead, so the board stays in view while it points.
          const shownByTack =
            command.taskId !== undefined && tackShow(command.boardId, command.taskId);
          const search = boardSearchOfIntent(environmentId, command);
          await router.navigate({
            to: "/board",
            search: shownByTack ? { ...search, open: undefined } : search,
          });
          return;
        }
        case "view.back":
          router.history.back();
          return;
        case "thread.draftPrompt": {
          const thread = scopeThreadRef(environmentId, ThreadId.make(command.threadId));
          useComposerDraftStore.getState().setPrompt(thread, command.text);
          await router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(thread),
          });
        }
      }
    }
  }, [intent, environmentId, router, acknowledge]);

  return null;
}
