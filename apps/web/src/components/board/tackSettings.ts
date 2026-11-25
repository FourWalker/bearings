import {
  type EnvironmentId,
  type ModelSelection,
  ProviderInstanceId,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

/**
 * Project Board fork: Tack's settings that more than one screen reads, kept on this device.
 * The Settings page's Tack section edits them all.
 */
export const TACK_HOMES = ["board", "panel"] as const;
/** Where the Roamer sleeps: the board's bottom right corner, or the foot of the side panel. */
export type TackHome = (typeof TACK_HOMES)[number];
const HomeSchema = Schema.Literals(TACK_HOMES);

export function useTackHome() {
  return useLocalStorage<TackHome, TackHome>("t3.board.assistant.home", "board", HomeSchema);
}

/** Whether the board's side panel ("Where things stand") is showing. */
export function useBoardPanelOpen() {
  return useLocalStorage<boolean, boolean>("t3.board.panel.open", true, Schema.Boolean);
}

/** board: Tack on the board. task: Tack inside an open task or module. */
export type TackModelRole = "board" | "task";

export const TACK_ACCESS = ["ask", "full"] as const;
/** How far Tack's thread may act without asking: every step approved, or full access. */
export type TackAccess = (typeof TACK_ACCESS)[number];
const AccessSchema = Schema.Struct({
  board: Schema.Literals(TACK_ACCESS),
  task: Schema.Literals(TACK_ACCESS),
});
const ACCESS_KEY = "t3.board.assistant.access";
// Tack on the board answers and shows; Tack in a task is there to do the task's work.
const DEFAULT_ACCESS: typeof AccessSchema.Type = { board: "ask", task: "full" };
const decodeAccess = Schema.decodeUnknownSync(AccessSchema);

export function useTackAccess() {
  return useLocalStorage(ACCESS_KEY, DEFAULT_ACCESS, AccessSchema);
}

export const tackRuntimeMode = (access: TackAccess): RuntimeMode =>
  access === "full" ? "full-access" : "approval-required";

/** Read at send time, so a changed setting also holds for a Tack thread that already exists. */
export function readTackRuntimeMode(role: TackModelRole): RuntimeMode {
  try {
    const stored = window.localStorage.getItem(ACCESS_KEY);
    return tackRuntimeMode(
      (stored === null ? DEFAULT_ACCESS : decodeAccess(JSON.parse(stored)))[role],
    );
  } catch {
    return tackRuntimeMode(DEFAULT_ACCESS[role]);
  }
}
const Pick = Schema.Struct({ instanceId: Schema.String, model: Schema.String });
const Picks = Schema.Struct({
  board: Schema.optional(Schema.NullOr(Pick)),
  task: Schema.optional(Schema.NullOr(Pick)),
});
const ModelsSchema = Schema.Record(Schema.String, Picks);
const MODELS_KEY = "t3.board.assistant.model";
const NO_MODELS: typeof ModelsSchema.Type = {};
const decodeModels = Schema.decodeUnknownSync(ModelsSchema);

/** The model Tack's new chats start on, per environment; nothing chosen means the project's default. */
export function useTackModels() {
  return useLocalStorage(MODELS_KEY, NO_MODELS, ModelsSchema);
}

/** Read at send time, outside React: the model chosen for Tack in this role, if any. */
export function readTackModel(
  environmentId: EnvironmentId,
  role: TackModelRole,
): ModelSelection | null {
  try {
    const stored = window.localStorage.getItem(MODELS_KEY);
    if (stored === null) return null;
    const pick = decodeModels(JSON.parse(stored))[environmentId]?.[role];
    return pick == null
      ? null
      : { instanceId: ProviderInstanceId.make(pick.instanceId), model: pick.model };
  } catch {
    return null;
  }
}
