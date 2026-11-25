import { BOARD_TOOLS } from "@t3tools/board-core";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as BoardChats from "../../../board/BoardChats.ts";
import * as BoardIntents from "../../../board/BoardIntents.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

interface JsonSchema {
  readonly type?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly description?: string;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: ReadonlyArray<string>;
}

/** The board tools' inputs are kept as JSON Schema in board-core, shared with the Claude mod. */
const toField = (json: JsonSchema): Schema.Top => {
  const base: Schema.Top =
    json.enum !== undefined && json.enum.length > 0
      ? Schema.Literals(json.enum as [string | number, ...Array<string | number>])
      : json.type === "string"
        ? Schema.String
        : json.type === "number"
          ? Schema.Number
          : json.type === "boolean"
            ? Schema.Boolean
            : json.type === "array"
              ? Schema.Array(json.items ? toField(json.items) : Schema.Unknown)
              : json.type === "object"
                ? toStruct(json)
                : Schema.Unknown;
  return json.description === undefined ? base : base.annotate({ description: json.description });
};

type BoardParams = Schema.Codec<Record<string, unknown>, Record<string, unknown>, never, never>;

const toStruct = (json: JsonSchema): BoardParams =>
  Schema.Struct(
    Object.fromEntries(
      Object.entries(json.properties ?? {}).map(([key, value]) => [
        key,
        json.required?.includes(key) ? toField(value) : Schema.optionalKey(toField(value)),
      ]),
    ),
  ) as unknown as BoardParams;

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  success: Schema.Struct({ text: Schema.String }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    BoardChats.BoardChats,
  ],
};

const definition = (name: string) => {
  const found = BOARD_TOOLS.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`board-core has no tool ${name}`);
  return {
    ...shared,
    description: found.description,
    parameters: toStruct(found.inputSchema as JsonSchema),
  };
};

/** T3 only: the Claude Code mod has no window to steer, so this tool is not in board-core. */
const BoardShowTool = Tool.make("board_show", {
  ...shared,
  dependencies: [...shared.dependencies, BoardIntents.BoardIntents],
  description:
    "Show something in the person's open T3 window. `open`: this board, or one task on it by `taskId`, with an optional `view` or `filter`. `back`: the page before. `draft`: put `text` in the composer of thread `threadId` for the person to send. Takes ids only, so find the task first with board_find. Changes no board data and sends nothing. With no window open it answers with a link to give the person.",
  parameters: Schema.Struct({
    action: Schema.Literals(["open", "back", "draft"]),
    taskId: Schema.optionalKey(Schema.String),
    view: Schema.optionalKey(Schema.Literals(["tree", "1", "2", "3", "svc", "register"])),
    filter: Schema.optionalKey(Schema.Literals(["active", "paused", "done", "all"])),
    threadId: Schema.optionalKey(Schema.String),
    text: Schema.optionalKey(Schema.String),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

/** Board tools act as the calling thread's chat, so outside MCP clients never see them. */
export const BoardToolkit = Toolkit.make(
  BoardShowTool,
  Tool.make("board_setup", definition("board_setup")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_link", definition("board_link")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_update", definition("board_update")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_plan", definition("board_plan")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_handoff", definition("board_handoff")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_create_task", definition("board_create_task")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_decision", definition("board_decision")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_master_plan", definition("board_master_plan")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_doc", definition("board_doc")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_release", definition("board_release")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_link_task", definition("board_link_task")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_move", definition("board_move")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_find", definition("board_find"))
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients),
  Tool.make("board_goal", definition("board_goal")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_promote", definition("board_promote")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_checkpoint", definition("board_checkpoint")).annotate(
    McpSchema.EnabledWhen,
    McpInvocationContext.hiddenFromOutsideClients,
  ),
  Tool.make("board_read", definition("board_read"))
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients),
);
