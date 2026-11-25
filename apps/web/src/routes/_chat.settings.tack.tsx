import { createFileRoute } from "@tanstack/react-router";

import { TackSettingsPanel } from "../components/settings/TackSettingsPanel";

function SettingsTackRoute() {
  return <TackSettingsPanel />;
}

export const Route = createFileRoute("/_chat/settings/tack")({
  component: SettingsTackRoute,
});
