import { BOARD_TOOLS } from "@t3tools/board-core";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as BoardChats from "../../../board/BoardChats.ts";
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

/** Board tools act as the calling thread's chat, so outside MCP clients never see them. */
export const BoardToolkit = Toolkit.make(
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
