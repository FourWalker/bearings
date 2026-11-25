import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readProject } from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";

import { type TackModelRole, readTackModel } from "./tackSettings";

/** How far a thread the board starts may act without asking: the project's default for new threads. */
export function boardThreadRunMode(environmentId: EnvironmentId, projectId: ProjectId) {
  const settings =
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
    DEFAULT_SERVER_SETTINGS;
  return resolveProjectSettings(
    settings,
    projectId,
    readProject(scopeProjectRef(environmentId, projectId)),
  ).settings.defaultRuntimeMode;
}

/**
 * The model a thread the board starts itself runs on: the one chosen for Tack in that role, while
 * its provider is still there, else the project's default; null when none is set up.
 */
export function boardThreadModelSelection(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  role?: TackModelRole,
) {
  const configs = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  const settings = configs?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = configs?.providers ?? [];
  const chosen = role === undefined ? null : readTackModel(environmentId, role);
  if (
    chosen !== null &&
    providers.some((provider) => provider.instanceId === chosen.instanceId && provider.enabled)
  )
    return chosen;
  return resolveNewThreadModelSelection({
    defaultSelection:
      resolveProjectSettings(
        settings,
        projectId,
        readProject(scopeProjectRef(environmentId, projectId)),
      ).settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, projectId),
    fallbackSelection: settings.fallbackModelSelection ?? null,
    providers,
    settings,
    projectId,
    now: Date.now(),
  }).selection;
}
