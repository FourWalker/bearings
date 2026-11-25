# @t3tools/board-core

This package holds the Project Board's rules and storage. Its only dependency is a few ports, so the
Claude Code mod and T3 Code run the same logic on the same files in `~/.claude-board`
(`T3_BOARD_HOME` overrides the folder).

It was ported from the mod's `hooks/register.ts`, keeping its texts and rules. The design is in
[docs/board/INTEGRATION.md](../../docs/board/INTEGRATION.md) and
[RECONCILIATION.md](../../docs/board/RECONCILIATION.md).

| File                  | What                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`            | Data model: boards, tasks, decisions, chat records (with `source`: Claude Code chat or T3 thread)                                          |
| `store.ts`            | `BoardStore`: registry, tasks, plans, handoffs, chat records                                                                               |
| `chat.ts`             | `BoardChat`: one chat or thread. Covers placement on a board, its record, the agent's context, all 16 `board_*` tools, and service tagging |
| `protocol.ts`         | Board rules and Board Mode, with the Claude Code text and the T3 text (rules 3, 4, 7, 10 and 11 reconciled)                                |
| `tools.ts`            | Tool names, descriptions and JSON input schemas                                                                                            |
| `io.ts` / `nodeIO.ts` | Ports for files, git and the clock, plus their Node implementations                                                                        |

A host's lifecycle maps onto `BoardChat` like this:

```ts
const chat = new BoardChat(new BoardStore(defaultBoardHome(), nodeIO), nodeGit, "t3");
await chat.open({
  sessionId: threadId,
  cwd,
  source: { kind: "t3-thread", threadId, provider, model },
});
await chat.turnStart(userText); // Claude Code: turn.start
chat.context; // prompt.compose section
await chat.runTool("board_link", args); // tool calls
await chat.fileChanged(path); // Edit/Write, or a turn's changed files
await chat.turnComplete(answerText); // turn.complete
await chat.end(); // session.end
```
