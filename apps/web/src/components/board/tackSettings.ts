import { type EnvironmentId, type ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
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
