import { createBoardEnvironmentAtoms } from "@t3tools/client-runtime/state/board";

import { connectionAtomRuntime } from "../connection/runtime";

/** Project Board fork. */
export const boardEnvironment = createBoardEnvironmentAtoms(connectionAtomRuntime);
