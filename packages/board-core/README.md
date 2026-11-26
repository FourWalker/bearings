# @t3tools/board-core

This package holds the Project Board's rules and storage, which T3 Code runs on the files in
`~/.claude-board` (`T3_BOARD_HOME` overrides the folder). Its only dependency is a few ports.

It began as a port of the standalone Claude Code mod, which is no longer kept in sync. The design is in
[docs/board/INTEGRATION.md](../../docs/board/INTEGRATION.md) and
[RECONCILIATION.md](../../docs/board/RECONCILIATION.md).

| File                  | What                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`            | Data model: boards, tasks, decisions, chat records (with `source`: T3 thread, or a chat from the old mod)                                  |
| `store.ts`            | `BoardStore`: registry, tasks, plans, handoffs, chat records                                                                               |
| `chat.ts`             | `BoardChat`: one chat or thread. Covers placement on a board, its record, the agent's context, all 16 `board_*` tools, and service tagging |
| `protocol.ts`         | Board rules and Board Mode as T3 threads get them                                                                                          |
| `tools.ts`            | Tool names, descriptions and JSON input schemas                                                                                            |
| `io.ts` / `nodeIO.ts` | Ports for files, git and the clock, plus their Node implementations                                                                        |

A host's lifecycle maps onto `BoardChat` like this:

```ts
const chat = new BoardChat(new BoardStore(defaultBoardHome(), nodeIO), nodeGit);
await chat.open({
  sessionId: threadId,
  cwd,
  source: { kind: "t3-thread", threadId, provider, model },
});
await chat.turnStart(userText);
chat.context; // the board section of the prompt
await chat.runTool("board_link", args); // tool calls
await chat.fileChanged(path); // Edit/Write, or a turn's changed files
await chat.turnComplete(answerText);
await chat.end();
```
